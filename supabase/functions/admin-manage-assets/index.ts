import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/*
 * Simple single-admin gate: the caller's authenticated email must match the
 * ADMIN_EMAIL secret set on this Supabase project (Project Settings > Edge
 * Functions > Secrets, or `supabase secrets set ADMIN_EMAIL="you@example.com"`).
 * This is intentionally lightweight — there's no multi-role system yet, just
 * "is this the platform owner". Anyone else gets a 403.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminEmail = Deno.env.get("ADMIN_EMAIL");

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

    if (!adminEmail) {
      return jsonResponse(
        { success: false, error: "ADMIN_EMAIL secret not set on this project. Run: supabase secrets set ADMIN_EMAIL=\"you@example.com\"" },
        500,
      );
    }
    if (userData.user.email?.toLowerCase() !== adminEmail.toLowerCase()) {
      return jsonResponse({ success: false, error: "Not authorized" }, 403);
    }

    let body: {
      action?: "list" | "update_scrip_code";
      asset_id?: string;
      fivepaisa_scrip_code?: number | null;
    } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const action = body.action ?? "list";

    if (action === "list") {
      const { data, error } = await admin
        .from("assets")
        .select("id, symbol, market_type, name, fivepaisa_scrip_code")
        .order("market_type", { ascending: true })
        .order("symbol", { ascending: true });
      if (error) throw new Error(error.message);
      return jsonResponse({ success: true, assets: data ?? [] });
    }

    if (action === "update_scrip_code") {
      if (!body.asset_id) {
        return jsonResponse({ success: false, error: "asset_id is required" }, 400);
      }
      const { error } = await admin
        .from("assets")
        .update({ fivepaisa_scrip_code: body.fivepaisa_scrip_code ?? null })
        .eq("id", body.asset_id);
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
