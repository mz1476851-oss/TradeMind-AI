import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Allowed credential field names per broker — anything else in the submitted
// object is dropped so we never accidentally store unexpected junk.
const ALLOWED_FIELDS: Record<string, string[]> = {
  coindcx: ["api_key", "api_secret"],
  fivepaisa: [
    "app_source",
    "app_name",
    "user_id",
    "password",
    "user_key",
    "encryption_key",
    "client_code",
    "pin",
    "totp_secret",
  ],
};

function sanitizeCredentials(broker: string, raw: Record<string, unknown>) {
  const allowed = ALLOWED_FIELDS[broker] ?? [];
  const clean: Record<string, string> = {};
  for (const field of allowed) {
    const v = raw[field];
    if (typeof v === "string" && v.trim().length > 0) {
      clean[field] = v.trim();
    }
  }
  return clean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // The caller must send THEIR OWN session token (not the service key).
    // We verify it server-side before touching any row.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return jsonResponse({ success: false, error: "Missing Authorization header" }, 401);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return jsonResponse({ success: false, error: "Invalid or expired session" }, 401);
    }
    const userId = userData.user.id;

    let body: {
      action?: "status" | "save" | "delete";
      broker?: string;
      credentials?: Record<string, unknown>;
    } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const action = body.action ?? "status";

    // ---- Check which brokers this user has configured (never returns secret values) ----
    if (action === "status") {
      const { data, error } = await admin
        .from("user_broker_credentials")
        .select("broker, is_active, updated_at")
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return jsonResponse({ success: true, brokers: data ?? [] });
    }

    // ---- Save/update credentials for one broker ----
    if (action === "save") {
      const broker = body.broker;
      if (!broker || !ALLOWED_FIELDS[broker]) {
        return jsonResponse(
          { success: false, error: "broker must be 'coindcx' or 'fivepaisa'" },
          400,
        );
      }
      const clean = sanitizeCredentials(broker, body.credentials ?? {});
      if (Object.keys(clean).length === 0) {
        return jsonResponse({ success: false, error: "No valid credential fields provided" }, 400);
      }

      const { error } = await admin
        .from("user_broker_credentials")
        .upsert(
          {
            user_id: userId,
            broker,
            credentials: clean,
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,broker" },
        );
      if (error) throw new Error(error.message);
      return jsonResponse({ success: true });
    }

    // ---- Remove a broker's credentials ----
    if (action === "delete") {
      const broker = body.broker;
      if (!broker) {
        return jsonResponse({ success: false, error: "broker is required" }, 400);
      }
      const { error } = await admin
        .from("user_broker_credentials")
        .delete()
        .eq("user_id", userId)
        .eq("broker", broker);
      if (error) throw new Error(error.message);
      return jsonResponse({ success: true });
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
