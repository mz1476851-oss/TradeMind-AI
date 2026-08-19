import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

// How stale a job's last run can get before we consider it "down". Set a
// bit above the job's own schedule so normal jitter doesn't false-alarm.
const STALE_AFTER_MIN: Record<string, number> = {
  fetch_market_data: 5,   // runs every 1 min
  generate_signals: 20,   // runs every 10 min
  check_open_trades: 15,  // runs every 5 min
};

const JOB_LABELS: Record<string, string> = {
  fetch_market_data: "Price Data Collection",
  generate_signals: "Signal Generation & Trading",
  check_open_trades: "Position Monitoring",
};

// Once alarmed, don't re-notify every single health-check run (this job
// itself runs every few minutes) — wait this long between repeat nudges.
const RENOTIFY_COOLDOWN_MIN = 30;

interface PipelineRun {
  job_name: string;
  status: "success" | "error";
  created_at: string;
  summary: Record<string, unknown>;
}

interface AlertState {
  job_name: string;
  is_alarmed: boolean;
  last_notified_at: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const checked: Record<string, unknown> = {};

  try {
    const jobNames = Object.keys(STALE_AFTER_MIN);

    const [runsRes, stateRes, usersRes] = await Promise.all([
      supabase
        .from("pipeline_runs")
        .select("job_name, status, created_at, summary")
        .in("job_name", jobNames)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("alert_state").select("job_name, is_alarmed, last_notified_at"),
      supabase.from("profiles").select("id"),
    ]);

    const runs = (runsRes.data as PipelineRun[]) ?? [];
    const stateByJob = new Map<string, AlertState>();
    for (const s of (stateRes.data as AlertState[]) ?? []) stateByJob.set(s.job_name, s);
    const userIds = ((usersRes.data as { id: string }[]) ?? []).map((u) => u.id);

    const now = Date.now();

    for (const jobName of jobNames) {
      const latest = runs.find((r) => r.job_name === jobName);
      const staleAfterMs = STALE_AFTER_MIN[jobName] * 60_000;

      const ageMs = latest ? now - new Date(latest.created_at).getTime() : Infinity;
      const isDown = !latest || ageMs > staleAfterMs || latest.status === "error";

      const prevState = stateByJob.get(jobName);
      const wasAlarmed = prevState?.is_alarmed ?? false;

      checked[jobName] = {
        isDown,
        lastRun: latest?.created_at ?? null,
        ageMinutes: latest ? Math.round(ageMs / 60000) : null,
      };

      if (isDown) {
        const cooldownOk =
          !prevState?.last_notified_at ||
          now - new Date(prevState.last_notified_at).getTime() > RENOTIFY_COOLDOWN_MIN * 60_000;

        // Notify on: first time going down, or cooldown elapsed while still down.
        if (!wasAlarmed || cooldownOk) {
          const reason = !latest
            ? "has never reported in"
            : latest.status === "error"
              ? `last run failed: ${JSON.stringify(latest.summary ?? {}).slice(0, 150)}`
              : `hasn't reported in ${Math.round(ageMs / 60000)} minutes`;

          const title = `⚠️ ${JOB_LABELS[jobName] ?? jobName} is down`;
          const message = `${JOB_LABELS[jobName] ?? jobName} ${reason}. Check the System Health panel.`;

          if (userIds.length > 0) {
            await supabase.from("notifications").insert(
              userIds.map((uid) => ({
                user_id: uid,
                type: "system_alert",
                title,
                message,
              })),
            );
          }

          await supabase.from("alert_state").upsert({
            job_name: jobName,
            is_alarmed: true,
            last_notified_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      } else if (wasAlarmed) {
        // Recovered — clear the alarm and send a one-time "back up" notice.
        const title = `✅ ${JOB_LABELS[jobName] ?? jobName} recovered`;
        const message = `${JOB_LABELS[jobName] ?? jobName} is reporting normally again.`;

        if (userIds.length > 0) {
          await supabase.from("notifications").insert(
            userIds.map((uid) => ({
              user_id: uid,
              type: "system_alert",
              title,
              message,
            })),
          );
        }

        await supabase.from("alert_state").upsert({
          job_name: jobName,
          is_alarmed: false,
          last_notified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    return jsonResponse({ ok: true, checked });
  } catch (err) {
    console.error("check-pipeline-health error:", err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
