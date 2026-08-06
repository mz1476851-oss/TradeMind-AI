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
  trade_type: string;
  entry_price: number;
  quantity: number;
  stop_loss: number | null;
  take_profit: number | null;
  status: string;
  opened_at: string;
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
      .select("id, user_id, asset_id, trade_type, entry_price, quantity, stop_loss, take_profit, status, opened_at")
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
