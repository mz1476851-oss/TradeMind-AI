import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const COINDCX_BASE = "https://api.coindcx.com";

// Assets are stored internally as "BTC/USD" (matches the CoinGecko price-fetch
// lookup table). CoinDCX's spot API needs a plain pair code. This defaults to a
// USDT pair (e.g. "BTCUSDT") to stay consistent with the USD-based prices used
// for position sizing elsewhere in the app. If your CoinDCX account only trades
// INR pairs (common for Indian accounts), change the suffix below to "INR" —
// but note the position-sizing math elsewhere assumes USD prices, so INR pairs
// will need that reconciled too before using real money.
function toCoindcxSymbol(symbol: string): string {
  return symbol.toUpperCase().replace("/USD", "USDT").replace(/[^A-Z0-9]/g, "");
}

// ---- HMAC-SHA256 Signing (CoinDCX signs the raw JSON body string) ----
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface CoindcxOrder {
  id: string;
  market: string;
  order_type: string;
  side: string;
  status: string;
  total_quantity: number;
  remaining_quantity: number;
  avg_price: number;
}

// Retries only transient failures — network errors, 5xx, and 429 (rate
// limit). A 4xx like bad signature or insufficient balance won't fix itself
// on retry, so those fail immediately instead of wasting attempts.
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 400;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function signedPost(path: string, apiKey: string, apiSecret: string, body: Record<string, unknown>) {
  const jsonBody = JSON.stringify(body);
  const signature = await hmacSha256Hex(apiSecret, jsonBody);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${COINDCX_BASE}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AUTH-APIKEY": apiKey,
          "X-AUTH-SIGNATURE": signature,
        },
        body: jsonBody,
      });
      const data = await response.json();

      if (!response.ok) {
        const transient = response.status === 429 || response.status >= 500;
        const err = new Error(`CoinDCX request failed (${response.status}): ${JSON.stringify(data)}`);
        if (!transient || attempt === MAX_RETRIES) throw err;
        lastError = err;
        await sleep(BASE_DELAY_MS * 2 ** attempt);
        continue;
      }

      return data;
    } catch (err) {
      // Network-level failure (fetch itself threw) — always worth retrying.
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === MAX_RETRIES) throw lastError;
      await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw lastError ?? new Error("CoinDCX request failed after retries");
}

interface CoindcxBalance {
  currency: string;
  balance: number;
  locked_balance: number;
}

async function getBalances(apiKey: string, apiSecret: string): Promise<CoindcxBalance[]> {
  const data = await signedPost("/exchange/v1/users/balances", apiKey, apiSecret, {
    timestamp: Date.now(),
  });
  return (Array.isArray(data) ? data : []) as CoindcxBalance[];
}

async function placeMarketOrder(
  apiKey: string,
  apiSecret: string,
  market: string,
  side: "buy" | "sell",
  quantity: number,
): Promise<CoindcxOrder> {
  const data = await signedPost("/exchange/v1/orders/create", apiKey, apiSecret, {
    side,
    order_type: "market_order",
    market,
    total_quantity: quantity,
    timestamp: Date.now(),
  });
  const order = data?.orders?.[0] as CoindcxOrder | undefined;
  if (!order?.id) {
    throw new Error(`No order id returned from CoinDCX: ${JSON.stringify(data)}`);
  }
  return order;
}

async function getOrderStatus(apiKey: string, apiSecret: string, orderId: string): Promise<CoindcxOrder> {
  const data = await signedPost("/exchange/v1/orders/status", apiKey, apiSecret, {
    id: orderId,
    timestamp: Date.now(),
  });
  return (Array.isArray(data) ? data[0] : data) as CoindcxOrder;
}

// ---- Main Handler ----

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let body: {
      action?: "place_order" | "sync_fills" | "get_balance";
      trade_id?: string;
      symbol?: string; // CoinDCX market code, e.g. "BTCINR" or "BTCUSDT" — must match the asset's `symbol`
      side?: "BUY" | "SELL";
      quantity?: number;
      intent?: "open" | "close";
    };
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const action = body.action ?? "place_order";

    // ---- Fetch the caller's own real CoinDCX balance ----
    // Unlike place_order/sync_fills (called server-side with a trade_id),
    // this is called directly from the Settings page by the logged-in user,
    // so it authenticates via their session JWT instead.
    if (action === "get_balance") {
      const authHeader = req.headers.get("Authorization") ?? "";
      const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!jwt) {
        return jsonResponse({ success: false, error: "Missing Authorization header" }, 401);
      }
      const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
      if (userErr || !userData?.user) {
        return jsonResponse({ success: false, error: "Invalid or expired session" }, 401);
      }

      const { data: credRow, error: credErr } = await supabase
        .from("user_broker_credentials")
        .select("credentials")
        .eq("user_id", userData.user.id)
        .eq("broker", "coindcx")
        .eq("is_active", true)
        .maybeSingle();
      if (credErr) throw new Error(credErr.message);
      const creds = credRow?.credentials as { api_key?: string; api_secret?: string } | undefined;
      if (!creds?.api_key || !creds?.api_secret) {
        return jsonResponse({ success: false, error: "CoinDCX API keys not configured" }, 400);
      }

      const balances = await getBalances(creds.api_key, creds.api_secret);
      const nonZero = balances.filter((b) => b.balance > 0 || b.locked_balance > 0);
      return jsonResponse({ success: true, balances: nonZero });
    }

    if (action === "place_order") {
      if (!body.trade_id || !body.symbol || !body.side || !body.quantity) {
        return jsonResponse(
          { success: false, error: "Missing required fields: trade_id, symbol, side, quantity" },
          400,
        );
      }

      // Look up which user this trade belongs to, so we use THEIR CoinDCX keys.
      const { data: trade, error: tradeErr } = await supabase
        .from("trades")
        .select("id, user_id")
        .eq("id", body.trade_id)
        .single();
      if (tradeErr || !trade) {
        return jsonResponse({ success: false, error: "Trade not found" }, 404);
      }

      const { data: credRow, error: credErr } = await supabase
        .from("user_broker_credentials")
        .select("credentials")
        .eq("user_id", trade.user_id)
        .eq("broker", "coindcx")
        .eq("is_active", true)
        .maybeSingle();
      if (credErr) throw new Error(credErr.message);
      const creds = credRow?.credentials as { api_key?: string; api_secret?: string } | undefined;
      if (!creds?.api_key || !creds?.api_secret) {
        return jsonResponse(
          { success: false, error: "CoinDCX API keys not configured. Add them in Settings first." },
          400,
        );
      }

      const side = body.side === "BUY" ? "buy" : "sell";
      const order = await placeMarketOrder(creds.api_key, creds.api_secret, toCoindcxSymbol(body.symbol), side, body.quantity);

      // Same rule as binance-testnet-trade: only persist entry_price/broker refs
      // when this order is OPENING the position, never when it's the closing
      // order for an exit — otherwise entry_price gets clobbered with the exit
      // fill price. fill_price is always returned to the caller either way.
      if ((body.intent ?? "open") === "open") {
        const updateData: Record<string, unknown> = {
          broker: "coindcx",
          broker_order_ref: order.id,
        };
        if (order.avg_price && order.avg_price > 0) {
          updateData.entry_price = order.avg_price;

          // Keep stop_loss/take_profit the correct distance from the REAL
          // fill price instead of drifting from the theoretical signal-time
          // entry — see binance-testnet-trade for the same fix and rationale.
          const { data: existingTrade } = await supabase
            .from("trades")
            .select("entry_price, stop_loss, take_profit")
            .eq("id", body.trade_id)
            .single();
          if (existingTrade) {
            const delta = order.avg_price - Number(existingTrade.entry_price);
            if (existingTrade.stop_loss !== null) {
              updateData.stop_loss = Math.round((Number(existingTrade.stop_loss) + delta) * 1000000) / 1000000;
            }
            if (existingTrade.take_profit !== null) {
              updateData.take_profit = Math.round((Number(existingTrade.take_profit) + delta) * 1000000) / 1000000;
            }
          }
        }
        await supabase.from("trades").update(updateData).eq("id", body.trade_id);
      }

      return jsonResponse({
        success: true,
        order_id: order.id,
        status: order.status,
        fill_price: order.avg_price ?? null,
      });
    }

    if (action === "sync_fills") {
      let query = supabase
        .from("trades")
        .select("id, user_id, entry_price, status, broker_order_ref")
        .eq("execution_mode", "coindcx_live")
        .not("broker_order_ref", "is", null)
        .in("status", ["open", "pending"]);
      if (body.trade_id) query = query.eq("id", body.trade_id);

      const { data: trades, error: tradeErr } = await query;
      if (tradeErr) throw new Error(tradeErr.message);
      if (!trades || trades.length === 0) {
        return jsonResponse({ success: true, synced: 0, message: "No CoinDCX trades to sync" });
      }

      let synced = 0;
      const errors: string[] = [];
      // Cache credentials per user within this run to avoid repeat lookups
      const credCache = new Map<string, { api_key: string; api_secret: string } | null>();

      for (const trade of trades as Array<{
        id: string;
        user_id: string;
        entry_price: number;
        status: string;
        broker_order_ref: string;
      }>) {
        try {
          let creds = credCache.get(trade.user_id);
          if (creds === undefined) {
            const { data: credRow } = await supabase
              .from("user_broker_credentials")
              .select("credentials")
              .eq("user_id", trade.user_id)
              .eq("broker", "coindcx")
              .maybeSingle();
            const c = credRow?.credentials as { api_key?: string; api_secret?: string } | undefined;
            creds = c?.api_key && c?.api_secret ? { api_key: c.api_key, api_secret: c.api_secret } : null;
            credCache.set(trade.user_id, creds);
          }
          if (!creds) continue;

          const status = await getOrderStatus(creds.api_key, creds.api_secret, trade.broker_order_ref);
          if (status?.status === "filled" && status.avg_price > 0) {
            await supabase
              .from("trades")
              .update({ entry_price: status.avg_price })
              .eq("id", trade.id);
            synced++;
          }
        } catch (e) {
          errors.push(`${trade.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      return jsonResponse({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
    }

    return jsonResponse({ success: false, error: `Unknown action: ${action}` }, 400);
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
