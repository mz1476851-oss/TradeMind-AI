import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/*
 * IMPORTANT — read before enabling this with real money:
 *
 * 5paisa's API does NOT use a simple static API key + secret like Binance/CoinDCX.
 * It uses a TOTP-based login flow that issues a short-lived RequestToken, which is
 * then exchanged for an AccessToken used on every subsequent call:
 *   1. POST TOTPLogin  -> { ClientCode, TOTP, PIN }        => RequestToken
 *   2. POST GetAccessToken (Oauth login) with RequestToken  => AccessToken
 *   3. POST OrderRequest with AccessToken                   => places the order
 *
 * The exact request/response shapes below follow 5paisa's publicly documented
 * TOTP + OAuth pattern (as used by their official SDKs), but 5paisa can change
 * field names/endpoints without notice and this has NOT been tested against a
 * live account here. Before routing any real capital through this function:
 *   - Verify each endpoint against the current docs at https://www.5paisa.com/developerapi
 *   - Test with a tiny quantity first
 *   - Watch the edge function logs for the raw 5paisa response on the first few calls
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FIVEPAISA_BASE = "https://Openapi.5paisa.com/VendorsAPI/Service1.svc";

interface FivepaisaCreds {
  app_source?: string;
  app_name?: string;
  user_id?: string;
  password?: string;
  user_key?: string;
  encryption_key?: string;
  client_code?: string;
  pin?: string;
  totp_secret?: string; // base32 TOTP secret — a 6-digit code is generated from this at call time
}

// ---- TOTP code generation (RFC 6238, SHA1, 30s step, 6 digits) ----
function base32Decode(input: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const char of clean) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

async function generateTotp(secret: string): Promise<string> {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBytes = new ArrayBuffer(8);
  new DataView(counterBytes).setBigUint64(0, BigInt(counter));

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, counterBytes));
  const offset = hmac[hmac.length - 1] & 0xf;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binCode % 1_000_000).toString().padStart(6, "0");
}

// Retries transient network/server failures (fetch throwing, 5xx, 429).
// TOTP login isn't retried on a fresh code inside this helper — the caller
// regenerates a new TOTP each login attempt anyway since login is only
// called once per trade, so a network-level retry here is still safe within
// the ~30s TOTP validity window.
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 400;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, init);
      if (resp.status === 429 || resp.status >= 500) {
        if (attempt === MAX_RETRIES) return resp;
        await sleep(BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      return resp;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === MAX_RETRIES) throw lastError;
      await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
  }
  throw lastError ?? new Error("5paisa request failed after retries");
}

async function loginAndGetAccessToken(creds: FivepaisaCreds): Promise<string> {
  if (!creds.client_code || !creds.pin || !creds.totp_secret || !creds.user_key || !creds.encryption_key || !creds.user_id) {
    throw new Error("5paisa credentials incomplete — need client_code, pin, totp_secret, user_key, encryption_key, user_id");
  }

  const totp = await generateTotp(creds.totp_secret);

  // Step 1: TOTP login -> RequestToken
  const totpResp = await fetchWithRetry(`${FIVEPAISA_BASE}/TOTPLogin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      head: { Key: creds.user_key },
      body: {
        UserKey: creds.user_key,
        ClientCode: creds.client_code,
        TOTP: totp,
        PIN: creds.pin,
      },
    }),
  });
  const totpData = await totpResp.json();
  const requestToken = totpData?.body?.RequestToken;
  if (!requestToken) {
    throw new Error(`5paisa TOTP login failed: ${JSON.stringify(totpData)}`);
  }

  // Step 2: Exchange RequestToken for AccessToken
  const tokenResp = await fetchWithRetry(`${FIVEPAISA_BASE}/GetAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      head: { Key: creds.user_key },
      body: {
        RequestToken: requestToken,
        EncryKey: creds.encryption_key,
        UserId: creds.user_id,
      },
    }),
  });
  const tokenData = await tokenResp.json();
  const accessToken = tokenData?.body?.AccessToken;
  if (!accessToken) {
    throw new Error(`5paisa access token exchange failed: ${JSON.stringify(tokenData)}`);
  }
  return accessToken;
}

async function placeOrder(
  accessToken: string,
  clientCode: string,
  side: "BUY" | "SELL",
  scripCode: number,
  quantity: number,
) {
  const resp = await fetchWithRetry(`${FIVEPAISA_BASE}/V1/OrderRequest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      head: {},
      body: {
        ClientCode: clientCode,
        Exchange: "N",
        ExchangeType: "C",
        ScripCode: scripCode,
        OrderType: side === "BUY" ? "B" : "S",
        AtMarket: true,
        Qty: quantity,
        Price: 0,
        IsIntraday: false,
      },
    }),
  });
  const data = await resp.json();
  const orderResult = data?.body;
  if (!orderResult?.BrokerOrderID && orderResult?.Message) {
    throw new Error(`5paisa order failed: ${orderResult.Message}`);
  }
  return orderResult;
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
      action?: "place_order";
      trade_id?: string;
      scrip_code?: number; // 5paisa's numeric ScripCode for the instrument (NOT the plain symbol)
      side?: "BUY" | "SELL";
      quantity?: number;
    };
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if ((body.action ?? "place_order") !== "place_order") {
      return jsonResponse({ success: false, error: `Unknown action: ${body.action}` }, 400);
    }

    if (!body.trade_id || !body.scrip_code || !body.side || !body.quantity) {
      return jsonResponse(
        { success: false, error: "Missing required fields: trade_id, scrip_code, side, quantity" },
        400,
      );
    }

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
      .eq("broker", "fivepaisa")
      .eq("is_active", true)
      .maybeSingle();
    if (credErr) throw new Error(credErr.message);
    const creds = credRow?.credentials as FivepaisaCreds | undefined;
    if (!creds?.client_code) {
      return jsonResponse(
        { success: false, error: "5paisa API keys not configured. Add them in Settings first." },
        400,
      );
    }

    const accessToken = await loginAndGetAccessToken(creds);
    const order = await placeOrder(accessToken, creds.client_code, body.side, body.scrip_code, body.quantity);

    await supabase
      .from("trades")
      .update({
        broker: "fivepaisa",
        broker_order_ref: String(order?.BrokerOrderID ?? order?.ExchOrderID ?? ""),
      })
      .eq("id", body.trade_id);

    return jsonResponse({ success: true, order_id: order?.BrokerOrderID, raw: order });
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
