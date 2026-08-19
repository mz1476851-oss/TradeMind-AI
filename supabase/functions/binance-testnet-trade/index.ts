import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BINANCE_BASE = "https://testnet.binance.vision";

// Assets are stored internally as "BTC/USD" (matches the CoinGecko price-fetch
// lookup table) but Binance's API needs a plain pair like "BTCUSDT". Convert here
// so callers can keep passing the asset's stored symbol unchanged.
function toBinanceSymbol(symbol: string): string {
  return symbol.toUpperCase().replace("/USD", "USDT").replace(/[^A-Z0-9]/g, "");
}

// ---- HMAC-SHA256 Signing ----
async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function buildQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

// ---- Binance API calls ----

interface BinanceOrderResponse {
  orderId?: number;
  status?: string;
  executedQty?: string;
  cummulativeQuoteQty?: string;
  avgPrice?: string;
  fills?: Array<{ price: string; qty: string; commission: string }>;
  symbol?: string;
  type?: string;
  side?: string;
  origQty?: string;
  transactTime?: number;
  code?: number;
  msg?: string;
}

// Retries only transient failures (network errors, 5xx, 429 rate-limit).
// A rejected order (bad signature, insufficient balance, LOT_SIZE, etc.) is a
// 4xx that won't change on retry, so those throw immediately.
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 400;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function placeMarketOrder(
  apiKey: string,
  secretKey: string,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: string,
): Promise<BinanceOrderResponse> {
  const roundedQuantity = await roundToLotSize(symbol, quantity);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Timestamp + signature must be freshly generated on every attempt —
    // Binance rejects requests whose timestamp drifts outside recvWindow.
    const timestamp = Date.now().toString();
    const params: Record<string, string> = {
      symbol: symbol.toUpperCase(),
      side,
      type: "MARKET",
      quantity: roundedQuantity,
      timestamp,
      recvWindow: "10000",
    };
    const query = buildQueryString(params);
    const signature = await hmacSha256(secretKey, query);
    const url = `${BINANCE_BASE}/api/v3/order?${query}&signature=${signature}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "X-MBX-APIKEY": apiKey },
      });
      const data = await response.json() as BinanceOrderResponse;

      if (!response.ok) {
        const transient = response.status === 429 || response.status >= 500;
        const err = new Error(`Binance order failed (${response.status}): ${data.msg ?? JSON.stringify(data)}`);
        if (!transient || attempt === MAX_RETRIES) throw err;
        lastError = err;
        await sleep(BASE_DELAY_MS * 2 ** attempt);
        continue;
      }

      return data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === MAX_RETRIES) throw lastError;
      await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw lastError ?? new Error("Binance order failed after retries");
}

// Binance rejects any quantity that isn't an exact multiple of the symbol's
// LOT_SIZE stepSize (and below minQty). Fetch the real filter for this symbol
// and round the requested quantity down to the nearest valid step so orders
// don't get rejected with "Filter failure: LOT_SIZE".
async function roundToLotSize(symbol: string, quantity: string): Promise<string> {
  const qty = parseFloat(quantity);
  try {
    const resp = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?symbol=${symbol.toUpperCase()}`);
    const info = await resp.json();
    const lotSizeFilter = info?.symbols?.[0]?.filters?.find(
      (f: { filterType?: string }) => f.filterType === "LOT_SIZE",
    ) as { stepSize?: string; minQty?: string } | undefined;

    if (!lotSizeFilter?.stepSize) {
      return quantity; // fall back to original if we couldn't read the filter
    }

    const stepSize = parseFloat(lotSizeFilter.stepSize);
    const minQty = parseFloat(lotSizeFilter.minQty ?? "0");
    const decimals = lotSizeFilter.stepSize.includes(".")
      ? lotSizeFilter.stepSize.split(".")[1].replace(/0+$/, "").length
      : 0;

    let rounded = Math.floor(qty / stepSize) * stepSize;
    if (rounded < minQty) rounded = minQty;

    return rounded.toFixed(decimals);
  } catch {
    return quantity; // network hiccup fetching exchangeInfo — try original quantity rather than failing outright
  }
}

async function getOrderStatus(
  apiKey: string,
  secretKey: string,
  symbol: string,
  orderId: number,
): Promise<BinanceOrderResponse> {
  const timestamp = Date.now().toString();
  const params: Record<string, string> = {
    symbol: symbol.toUpperCase(),
    orderId: orderId.toString(),
    timestamp,
    recvWindow: "10000",
  };
  const query = buildQueryString(params);
  const signature = await hmacSha256(secretKey, query);

  const url = `${BINANCE_BASE}/api/v3/order?${query}&signature=${signature}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-MBX-APIKEY": apiKey,
    },
  });

  const data = await response.json() as BinanceOrderResponse;
  if (!response.ok) {
    throw new Error(`Binance status check failed (${response.status}): ${data.msg ?? JSON.stringify(data)}`);
  }
  return data;
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

    // Load Binance credentials from app_secrets table (service role bypasses RLS)
    const { data: secretRows, error: secretErr } = await supabase
      .from("app_secrets")
      .select("key, value")
      .in("key", ["BINANCE_TESTNET_API_KEY", "BINANCE_TESTNET_SECRET_KEY"]);
    if (secretErr) {
      return jsonResponse({ success: false, error: `Failed to load secrets: ${secretErr.message}` }, 500);
    }
    const secretMap = new Map<string, string>();
    for (const row of (secretRows ?? []) as Array<{ key: string; value: string }>) {
      secretMap.set(row.key, row.value);
    }
    const apiKey = secretMap.get("BINANCE_TESTNET_API_KEY");
    const secretKey = secretMap.get("BINANCE_TESTNET_SECRET_KEY");

    if (!apiKey || !secretKey) {
      return jsonResponse(
        { success: false, error: "BINANCE_TESTNET_API_KEY or BINANCE_TESTNET_SECRET_KEY not configured in app_secrets table" },
        500,
      );
    }

    let body: {
      action?: "place_order" | "sync_fills";
      trade_id?: string;
      symbol?: string;
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

    // ---- Place a market order ----
    if (action === "place_order") {
      if (!body.trade_id || !body.symbol || !body.side || !body.quantity) {
        return jsonResponse(
          { success: false, error: "Missing required fields: trade_id, symbol, side, quantity" },
          400,
        );
      }

      // Format quantity to Binance precision (8 decimals max for most pairs)
      const qtyStr = body.quantity.toFixed(8).replace(/\.?0+$/, "");

      const orderResult = await placeMarketOrder(
        apiKey,
        secretKey,
        toBinanceSymbol(body.symbol),
        body.side,
        qtyStr,
      );

      if (!orderResult.orderId) {
        throw new Error("No orderId returned from Binance");
      }

      // Calculate fill price from fills array or avgPrice
      let fillPrice: number | null = null;
      if (orderResult.fills && orderResult.fills.length > 0) {
        let totalCost = 0;
        let totalQty = 0;
        for (const fill of orderResult.fills) {
          totalCost += parseFloat(fill.price) * parseFloat(fill.qty);
          totalQty += parseFloat(fill.qty);
        }
        if (totalQty > 0) fillPrice = totalCost / totalQty;
      } else if (orderResult.avgPrice && parseFloat(orderResult.avgPrice) > 0) {
        fillPrice = parseFloat(orderResult.avgPrice);
      }

      // Update the trade with broker_order_id and actual fill price — but only
      // when this order is OPENING the position. When it's the closing order
      // (intent: "close"), overwriting entry_price here would corrupt the
      // original entry with the exit fill price, so we skip the update and
      // just report fill_price back to the caller for their own PnL math.
      if ((body.intent ?? "open") === "open") {
        const updateData: Record<string, unknown> = {
          broker_order_id: orderResult.orderId,
        };
        if (fillPrice !== null) {
          const roundedFill = Math.round(fillPrice * 1000000) / 1000000;
          updateData.entry_price = roundedFill;

          // The real fill price can differ from the theoretical entry the
          // stop-loss/take-profit were calculated against (signal-time price
          // vs actual execution price). Shift SL/TP by the same delta so they
          // stay the correct distance from the REAL entry, instead of quietly
          // drifting out of sync with what's now shown as "entry" — e.g. a
          // take-profit that ends up below entry on a long position.
          const { data: existingTrade } = await supabase
            .from("trades")
            .select("entry_price, stop_loss, take_profit")
            .eq("id", body.trade_id)
            .single();
          if (existingTrade) {
            const delta = roundedFill - Number(existingTrade.entry_price);
            if (existingTrade.stop_loss !== null) {
              updateData.stop_loss = Math.round((Number(existingTrade.stop_loss) + delta) * 1000000) / 1000000;
            }
            if (existingTrade.take_profit !== null) {
              updateData.take_profit = Math.round((Number(existingTrade.take_profit) + delta) * 1000000) / 1000000;
            }
          }
        }

        await supabase
          .from("trades")
          .update(updateData)
          .eq("id", body.trade_id);
      }

      return jsonResponse({
        success: true,
        order_id: orderResult.orderId,
        status: orderResult.status,
        fill_price: fillPrice,
        executed_qty: orderResult.executedQty,
      });
    }

    // ---- Sync fills: check order status for testnet trades ----
    if (action === "sync_fills") {
      // Load all testnet trades that have a broker_order_id
      let query = supabase
        .from("trades")
        .select("id, asset_id, broker_order_id, entry_price, status")
        .eq("execution_mode", "testnet_live")
        .not("broker_order_id", "is", null)
        .in("status", ["open", "pending"]);

      if (body.trade_id) {
        query = query.eq("id", body.trade_id);
      }

      const { data: trades, error: tradeErr } = await query;
      if (tradeErr) throw new Error(`Failed to load trades: ${tradeErr.message}`);
      if (!trades || trades.length === 0) {
        return jsonResponse({ success: true, synced: 0, message: "No testnet trades to sync" });
      }

      // Load asset symbols
      const assetIds = [...new Set(trades.map((t) => t.asset_id))];
      const { data: assets } = await supabase
        .from("assets")
        .select("id, symbol")
        .in("id", assetIds);
      const assetMap = new Map<string, string>();
      for (const a of (assets ?? []) as Array<{ id: string; symbol: string }>) {
        assetMap.set(a.id, a.symbol);
      }

      let synced = 0;
      const errors: string[] = [];

      for (const trade of trades as Array<{
        id: string;
        asset_id: string;
        broker_order_id: number;
        entry_price: number;
        status: string;
      }>) {
        const symbol = assetMap.get(trade.asset_id);
        if (!symbol || !trade.broker_order_id) continue;

        try {
          const status = await getOrderStatus(
            apiKey,
            secretKey,
            toBinanceSymbol(symbol),
            trade.broker_order_id,
          );

          // If filled, update entry_price with actual fill price
          if (status.status === "FILLED" && status.avgPrice) {
            const actualPrice = parseFloat(status.avgPrice);
            if (actualPrice > 0) {
              await supabase
                .from("trades")
                .update({
                  entry_price: Math.round(actualPrice * 1000000) / 1000000,
                })
                .eq("id", trade.id);
              synced++;
            }
          }
        } catch (e) {
          errors.push(`${symbol}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      return jsonResponse({
        success: true,
        synced,
        errors: errors.length > 0 ? errors : undefined,
      });
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
