import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Asset } from '@/lib/types';
import { BarChart3, TrendingUp, TrendingDown, Info } from 'lucide-react';

interface AccuracyRow {
  id: string;
  asset_id: string;
  signal_term: 'short_term' | 'long_term';
  lookback_days: number;
  win_rate_pct: number;
  avg_return_pct: number;
  total_signals_tested: number;
  calculated_at: string;
}

export function BacktestPage() {
  const [rows, setRows] = useState<AccuracyRow[]>([]);
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [loading, setLoading] = useState(true);
  const [termFilter, setTermFilter] = useState<'all' | 'short_term' | 'long_term'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    const [accRes, assetRes] = await Promise.all([
      supabase
        .from('strategy_accuracy')
        .select('*')
        .order('win_rate_pct', { ascending: false }),
      supabase.from('assets').select('id, symbol, market_type, name, fivepaisa_scrip_code'),
    ]);
    setRows((accRes.data as AccuracyRow[]) ?? []);
    if (assetRes.data) {
      const map: Record<string, Asset> = {};
      for (const a of assetRes.data as Asset[]) map[a.id] = a;
      setAssets(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = termFilter === 'all' ? rows : rows.filter((r) => r.signal_term === termFilter);

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-sky-400" />
          <h1 className="text-lg font-semibold text-white">Backtest Results</h1>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          How each asset's signal logic performed against real historical price data — recalculated
          automatically every time signals are generated.
        </p>
      </div>

      <div className="flex items-start gap-2 bg-sky-500/10 border border-sky-500/20 rounded-lg px-3.5 py-2.5">
        <Info className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
        <p className="text-xs text-sky-300">
          These numbers reflect what would have happened if every signal had been auto-traded exactly
          as scored, over the last 90 days of collected price history. They aren't a promise about
          future signals — treat this as a diagnostic, not a guarantee.
        </p>
      </div>

      <div className="flex gap-2">
        {(['all', 'short_term', 'long_term'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTermFilter(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              termFilter === t
                ? 'border-sky-500 bg-sky-500/10 text-sky-400'
                : 'border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {t === 'all' ? 'All' : t === 'short_term' ? 'Short Term' : 'Long Term'}
          </button>
        ))}
      </div>

      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
        {loading ? (
          <p className="text-sm text-slate-500 p-6">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500 p-6">
            No backtest data yet — this fills in automatically once enough price history has been
            collected (needs 50+ price snapshots per asset).
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase">
                <th className="text-left px-4 py-3">Asset</th>
                <th className="text-left px-4 py-3">Term</th>
                <th className="text-right px-4 py-3">Win Rate</th>
                <th className="text-right px-4 py-3">Avg Return / Signal</th>
                <th className="text-right px-4 py-3">Signals Tested</th>
                <th className="text-right px-4 py-3">Lookback</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filtered.map((r) => {
                const asset = assets[r.asset_id];
                const positive = r.avg_return_pct >= 0;
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{asset?.symbol ?? r.asset_id}</p>
                      <p className="text-xs text-slate-500">{asset?.name}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-400 capitalize">{r.signal_term.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={r.win_rate_pct >= 50 ? 'text-emerald-400' : 'text-rose-400'}>
                        {r.win_rate_pct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex items-center gap-1 ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        {positive ? '+' : ''}{(r.avg_return_pct * 100).toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400">{r.total_signals_tested}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{r.lookback_days}d</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
