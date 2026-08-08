import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const COINDCX_BASE = "https://api.coindcx.com";

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

async function signedPost(path: string, apiKey: string, apiSecret: string, body: Record<string, unknown>) {
  const jsonBody = JSON.stringify(body);
  const signature = await hmacSha256Hex(apiSecret, jsonBody);
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
    throw new Error(`CoinDCX request failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return data;
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
      action?: "place_order" | "sync_fills";
      trade_id?: string;
      symbol?: string; // CoinDCX market code, e.g. "BTCINR" or "BTCUSDT" — must match the asset's `symbol`
      side?: "BUY" | "SELL";
      quantity?: number;
    };
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const action = body.action ?? "place_order";

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
      const order = await placeMarketOrder(creds.api_key, creds.api_secret, body.symbol, side, body.quantity);

      const updateData: Record<string, unknown> = {
        broker: "coindcx",
        broker_order_ref: order.id,
      };
      if (order.avg_price && order.avg_price > 0) {
        updateData.entry_price = order.avg_price;
      }

      await supabase.from("trades").update(updateData).eq("id", body.trade_id);

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
