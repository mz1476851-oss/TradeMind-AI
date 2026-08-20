import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Activity, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';

interface PipelineRun {
  id: string;
  job_name: 'fetch_market_data' | 'generate_signals' | 'check_open_trades';
  status: 'success' | 'error';
  summary: Record<string, unknown>;
  created_at: string;
}

const JOB_LABELS: Record<string, string> = {
  fetch_market_data: 'Price Data Collection',
  generate_signals: 'Signal Generation & Trading',
  check_open_trades: 'Position Monitoring',
};

const JOB_EXPECTED_INTERVAL_MIN: Record<string, number> = {
  fetch_market_data: 2,
  generate_signals: 10,
  check_open_trades: 5,
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function summaryLine(run: PipelineRun): string {
  const s = run.summary ?? {};
  if (run.status === 'error') return `Error: ${s.error ?? 'unknown error'}`;
  if (run.job_name === 'fetch_market_data') {
    return `${s.inserted ?? 0} price points collected`;
  }
  if (run.job_name === 'generate_signals') {
    return `${s.signals_inserted ?? 0} signals scored, ${s.trades_created ?? 0} trade(s) opened`;
  }
  if (run.job_name === 'check_open_trades') {
    return s.message ? String(s.message) : `${s.closed ?? 0} position(s) closed`;
  }
  return 'Completed';
}

export function SystemHealthCard() {
  const [runs, setRuns] = useState<Record<string, PipelineRun | null>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const jobs = ['fetch_market_data', 'generate_signals', 'check_open_trades'];
    const results: Record<string, PipelineRun | null> = {};
    for (const job of jobs) {
      const { data } = await supabase
        .from('pipeline_runs')
        .select('*')
        .eq('job_name', job)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      results[job] = (data as PipelineRun) ?? null;
    }
    setRuns(results);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('pipeline-runs-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pipeline_runs' }, () => {
        load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const isStale = (run: PipelineRun | null, jobName: string) => {
    if (!run) return true;
    const mins = (Date.now() - new Date(run.created_at).getTime()) / 60000;
    return mins > JOB_EXPECTED_INTERVAL_MIN[jobName] * 3; // more than 3x expected interval = stale
  };

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">System Health</h3>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Live status of the automated pipeline — updates on its own, nothing to check manually.
      </p>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-3">
          {(['fetch_market_data', 'generate_signals', 'check_open_trades'] as const).map((jobName) => {
            const run = runs[jobName];
            const stale = isStale(run, jobName);
            return (
              <div key={jobName} className="flex items-start gap-3">
                {!run ? (
                  <Clock className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                ) : run.status === 'error' ? (
                  <XCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
                ) : stale ? (
                  <Clock className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">{JOB_LABELS[jobName]}</p>
                    <p className="text-xs text-slate-500 shrink-0">
                      {run ? timeAgo(run.created_at) : 'never run yet'}
                    </p>
                  </div>
                  <p className={`text-xs mt-0.5 ${run?.status === 'error' ? 'text-rose-400' : 'text-slate-500'}`}>
                    {run ? summaryLine(run) : 'Waiting for first run…'}
                  </p>
                  {stale && run && run.status !== 'error' && (
                    <p className="text-xs text-amber-400 mt-0.5">
                      Running later than expected — check back shortly.
                    </p>
                  )}
                  {jobName === 'generate_signals' &&
                    run &&
                    run.status === 'success' &&
                    Number(run.summary?.trades_created ?? 0) === 0 &&
                    Array.isArray(run.summary?.skip_reasons_sample) &&
                    (run.summary!.skip_reasons_sample as string[]).length > 0 && (
                      <div className="mt-1.5">
                        <button
                          onClick={() => setExpanded(expanded === jobName ? null : jobName)}
                          className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"
                        >
                          Why no trades this run?
                          {expanded === jobName ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                        {expanded === jobName && (
                          <ul className="mt-1.5 space-y-1 bg-slate-800/40 rounded-lg p-2.5">
                            {(run.summary!.skip_reasons_sample as string[]).map((reason, i) => (
                              <li key={i} className="text-[11px] text-slate-400 leading-relaxed">
                                • {reason}
                              </li>
                            ))}
                            {Number(run.summary?.skip_reasons_total ?? 0) >
                              (run.summary!.skip_reasons_sample as string[]).length && (
                              <li className="text-[11px] text-slate-500 italic">
                                +{Number(run.summary!.skip_reasons_total) - (run.summary!.skip_reasons_sample as string[]).length} more
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
