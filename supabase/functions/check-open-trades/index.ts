import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface OpenTrade {
  id: string;
  user_id: string;
  asset_id: string;
  strategy_id: string | null;
  trade_type: string;
  entry_price: number;
  quantity: number;
  stop_loss: number | null;
  take_profit: number | null;
  status: string;
  opened_at: string;
  execution_mode: string;
  high_water_mark: number | null;
}

interface AssetInfo {
  id: string;
  symbol: string;
  fivepaisa_scrip_code: number | null;
}

interface AssetPrice {
  id: string;
  close: number;
}

function calcPnl(
  tradeType: string,
  entryPrice: number,
  exitPrice: number,
  quantity: number,
): number {
  const diff = tradeType === "long"
    ? exitPrice - entryPrice
    : entryPrice - exitPrice;
  return Math.round(diff * quantity * 100) / 100;
}

async function notify(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  type: string,
  title: string,
  message: string,
): Promise<void> {
  try {
    await supabase.from("notifications").insert({ user_id: userId, type, title, message });
  } catch {
    // best-effort — never block trade closing over a notification failure
  }
}

// For live-broker trades, hitting SL/TP in our own price data is not enough —
// the actual position on the exchange must be closed too, or the DB and the
// real account silently drift apart (we'd show "closed" while a real position
// stays open). This places the opposite-side order to flatten it before we
// mark the trade closed.
async function closeLivePosition(
  supabaseUrl: string,
  serviceKey: string,
  trade: OpenTrade,
  asset: AssetInfo | undefined,
): Promise<{ ok: boolean; error?: string; fillPrice?: number }> {
  if (!asset) return { ok: false, error: "asset not found" };
  const closingSide = trade.trade_type === "long" ? "SELL" : "BUY";

  try {
    if (trade.execution_mode === "testnet_live") {
      const resp = await fetch(`${supabaseUrl}/functions/v1/binance-testnet-trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
        body: JSON.stringify({
          action: "place_order",
          trade_id: trade.id,
          symbol: asset.symbol,
          side: closingSide,
          quantity: trade.quantity,
          intent: "close",
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return { ok: false, error: data.error ?? resp.statusText };
      }
      return { ok: true, fillPrice: typeof data.fill_price === "number" ? data.fill_price : undefined };
    }

    if (trade.execution_mode === "coindcx_live") {
      const resp = await fetch(`${supabaseUrl}/functions/v1/coindcx-trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
        body: JSON.stringify({
          action: "place_order",
          trade_id: trade.id,
          symbol: asset.symbol,
          side: closingSide,
          quantity: trade.quantity,
          intent: "close",
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return { ok: false, error: data.error ?? resp.statusText };
      }
      return { ok: true, fillPrice: typeof data.fill_price === "number" ? data.fill_price : undefined };
    }

    if (trade.execution_mode === "fivepaisa_live") {
      if (!asset.fivepaisa_scrip_code) {
        return { ok: false, error: "no fivepaisa_scrip_code mapped for this asset" };
      }
      const resp = await fetch(`${supabaseUrl}/functions/v1/fivepaisa-trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
        body: JSON.stringify({
          action: "place_order",
          trade_id: trade.id,
          scrip_code: asset.fivepaisa_scrip_code,
          side: closingSide,
          quantity: trade.quantity,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return { ok: false, error: err.error ?? resp.statusText };
      }
      // 5paisa's synchronous order response doesn't include a fill price here,
      // so PnL for 5paisa exits still falls back to the SL/TP level for now.
      return { ok: true };
    }

    // paper mode — nothing to close with a real broker
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Load all open trades
    const { data: openTrades, error: tradeError } = await supabase
      .from("trades")
      .select("id, user_id, asset_id, strategy_id, trade_type, entry_price, quantity, stop_loss, take_profit, status, opened_at, execution_mode, high_water_mark")
      .eq("status", "open");

    if (tradeError) throw new Error(`Failed to load trades: ${tradeError.message}`);
    if (!openTrades || openTrades.length === 0) {
      return jsonResponse({ success: true, closed: 0, message: "No open trades" });
    }

    // Get latest price for each asset involved
    const assetIds = [...new Set(openTrades.map((t) => t.asset_id))];
    const assetPrices = new Map<string, number>();

    for (const assetId of assetIds) {
      const { data: latest } = await supabase
        .from("market_data")
        .select("close")
        .eq("asset_id", assetId)
        .order("timestamp", { ascending: false })
        .limit(1);

      if (latest && latest.length > 0) {
        assetPrices.set(assetId, Number(latest[0].close));
      }
    }

    const { data: assetRows } = await supabase
      .from("assets")
      .select("id, symbol, fivepaisa_scrip_code")
      .in("id", assetIds);
    const assetMap = new Map<string, AssetInfo>();
    for (const a of (assetRows ?? []) as AssetInfo[]) {
      assetMap.set(a.id, a);
    }

    const strategyIds = [...new Set(
      (openTrades as OpenTrade[]).map((t) => t.strategy_id).filter((id): id is string => id !== null),
    )];
    const trailingPctMap = new Map<string, number>();
    if (strategyIds.length > 0) {
      const { data: strategyRows } = await supabase
        .from("strategies")
        .select("id, trailing_stop_pct")
        .in("id", strategyIds);
      for (const s of (strategyRows ?? []) as Array<{ id: string; trailing_stop_pct: number | null }>) {
        if (s.trailing_stop_pct && s.trailing_stop_pct > 0) {
          trailingPctMap.set(s.id, s.trailing_stop_pct);
        }
      }
    }

    let closedCount = 0;
    const closedByUser = new Map<string, number>(); // user_id -> pnl delta
    const errors: string[] = [];

    for (const trade of openTrades as OpenTrade[]) {
      const currentPrice = assetPrices.get(trade.asset_id);
      if (currentPrice === undefined) {
        errors.push(`Trade ${trade.id}: no price data for asset`);
        continue;
      }

      let shouldClose = false;
      let exitPrice = currentPrice;
      let closeReason = "";

      // Trailing stop: if this trade's strategy has trailing enabled, ratchet
      // the stop-loss toward the current price as it moves favorably. Never
      // loosens the stop — only tightens it, so downside never gets worse
      // than the original stop-loss.
      const trailingPct = trade.strategy_id ? trailingPctMap.get(trade.strategy_id) : undefined;
      if (trailingPct) {
        const isLong = trade.trade_type === "long";
        const priorMark = trade.high_water_mark ?? trade.entry_price;
        const newMark = isLong ? Math.max(priorMark, currentPrice) : Math.min(priorMark, currentPrice);

        if (newMark !== priorMark) {
          const candidateStop = isLong
            ? newMark * (1 - trailingPct / 100)
            : newMark * (1 + trailingPct / 100);
          const currentStop = trade.stop_loss ?? candidateStop;
          const tightenedStop = isLong
            ? Math.max(currentStop, candidateStop)
            : Math.min(currentStop, candidateStop);

          if (tightenedStop !== currentStop) {
            trade.stop_loss = tightenedStop;
          }
          trade.high_water_mark = newMark;

          await supabase
            .from("trades")
            .update({ stop_loss: trade.stop_loss, high_water_mark: newMark })
            .eq("id", trade.id);
        }
      }

      // Check stop-loss hit
      if (trade.stop_loss !== null) {
        if (trade.trade_type === "long" && currentPrice <= trade.stop_loss) {
          shouldClose = true;
          exitPrice = trade.stop_loss;
          closeReason = "stop_loss";
        } else if (trade.trade_type === "short" && currentPrice >= trade.stop_loss) {
          shouldClose = true;
          exitPrice = trade.stop_loss;
          closeReason = "stop_loss";
        }
      }

      // Check take-profit hit
      if (!shouldClose && trade.take_profit !== null) {
        if (trade.trade_type === "long" && currentPrice >= trade.take_profit) {
          shouldClose = true;
          exitPrice = trade.take_profit;
          closeReason = "take_profit";
        } else if (trade.trade_type === "short" && currentPrice <= trade.take_profit) {
          shouldClose = true;
          exitPrice = trade.take_profit;
          closeReason = "take_profit";
        }
      }

      if (!shouldClose) continue;

      // For live-broker trades, flatten the real position first. If that fails,
      // don't mark the trade closed — we'd otherwise show "closed" in the app
      // while a real position stays open on the exchange. It'll be retried on
      // the next run instead.
      if (trade.execution_mode !== "paper") {
        const closeResult = await closeLivePosition(supabaseUrl, serviceKey, trade, assetMap.get(trade.asset_id));
        if (!closeResult.ok) {
          errors.push(`Trade ${trade.id}: broker close failed (${closeResult.error}) — will retry next run, NOT marked closed`);
          continue;
        }
        // Use the broker's actual closing fill price for PnL, not the
        // theoretical SL/TP level — the real exchange fill is what actually
        // happened to the account.
        if (closeResult.fillPrice !== undefined && closeResult.fillPrice > 0) {
          exitPrice = closeResult.fillPrice;
        }
      }

      const pnl = calcPnl(trade.trade_type, trade.entry_price, exitPrice, trade.quantity);
      const now = new Date().toISOString();

      const { error: updateErr } = await supabase
        .from("trades")
        .update({
          status: "closed",
          exit_price: exitPrice,
          closed_at: now,
          pnl,
        })
        .eq("id", trade.id);

      if (updateErr) {
        errors.push(`Trade ${trade.id}: ${updateErr.message}`);
        continue;
      }

      closedCount++;
      closedByUser.set(
        trade.user_id,
        (closedByUser.get(trade.user_id) ?? 0) + pnl,
      );

      await notify(
        supabase,
        trade.user_id,
        pnl >= 0 ? "trade_closed_win" : "trade_closed_loss",
        `${pnl >= 0 ? "Closed in profit" : "Closed at a loss"}: ${assetMap.get(trade.asset_id)?.symbol ?? trade.asset_id}`,
        `Position closed via ${closeReason.replace("_", " ")} at ${exitPrice.toFixed(2)}. P&L: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}.`,
      );
    }

    // Update virtual_capital for each affected user + create snapshot
    for (const [userId, pnlDelta] of closedByUser) {
      // Load current profile
      const { data: profile } = await supabase
        .from("users_profile")
        .select("user_id, virtual_capital")
        .eq("user_id", userId)
        .maybeSingle();

      if (!profile) continue;

      const newCapital = Number(profile.virtual_capital) + pnlDelta;

      await supabase
        .from("users_profile")
        .update({ virtual_capital: newCapital })
        .eq("user_id", userId);

      // Count remaining open trades for snapshot
      const { count: openCount } = await supabase
        .from("trades")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "open");

      // Calculate unrealized PnL for open trades
      let unrealized = 0;
      const { data: stillOpen } = await supabase
        .from("trades")
        .select("asset_id, trade_type, entry_price, quantity")
        .eq("user_id", userId)
        .eq("status", "open");

      for (const t of stillOpen ?? []) {
        const p = assetPrices.get(t.asset_id);
        if (p !== undefined) {
          unrealized += calcPnl(t.trade_type, t.entry_price, p, t.quantity);
        }
      }

      const totalValue = newCapital + unrealized;

      await supabase.from("portfolio_snapshots").insert({
        user_id: userId,
        timestamp: new Date().toISOString(),
        total_value: Math.round(totalValue * 100) / 100,
        cash_balance: Math.round(newCapital * 100) / 100,
        unrealized_pnl: Math.round(unrealized * 100) / 100,
      });
    }

    return jsonResponse({
      success: true,
      closed: closedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return jsonResponse(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
