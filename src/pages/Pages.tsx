import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Radio,
  History,
  Settings2,
  RefreshCw,
  Check,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
  X,
  Hand,
  DollarSign,
  Activity,
  Trophy,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import type { PageId } from '@/components/DashboardShell';
import type { Signal, Asset, Trade, StrategyAccuracy } from '@/lib/types';
import { StrategiesPage as StrategiesPageImpl } from '@/pages/StrategiesPage';
import { TradeHistoryPage as TradeHistoryPageImpl } from '@/pages/TradeHistoryPage';
import { PortfolioPage as PortfolioPageImpl } from '@/pages/PortfolioPage';
import { SettingsPage as SettingsPageImpl } from '@/pages/SettingsPage';
import { AdminAssetsPage } from '@/pages/AdminAssetsPage';

interface RefreshResult {
  success: boolean;
  inserted?: number;
  markets?: { crypto: number; stocks: number; forex: number };
  errors?: string[];
  error?: string;
  message?: string;
}

interface GenerateResult {
  success: boolean;
  inserted?: number;
  errors?: string[];
  error?: string;
}

export function DashboardPage() {
  const { profile, user, refreshProfile } = useAuth();
  const capital = profile?.virtual_capital ?? 10000;
  const fmt = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null);
  const [snapshots, setSnapshots] = useState<{ timestamp: string; total_value: number }[]>([]);
  const [recentSignals, setRecentSignals] = useState<Signal[]>([]);
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [openCount, setOpenCount] = useState(0);
  const [closedTrades, setClosedTrades] = useState<Trade[]>([]);

  const loadDashboardData = useCallback(async () => {
    if (!user) return;
    const [snapRes, sigRes, assetRes, openRes, closedRes] = await Promise.all([
      supabase.from('portfolio_snapshots').select('timestamp, total_value').eq('user_id', user.id).order('timestamp', { ascending: true }).limit(60),
      supabase.from('signals').select('id, strategy_id, asset_id, signal_type, confidence_score, reasoning_text, generated_at, signal_term').order('generated_at', { ascending: false }).limit(8),
      supabase.from('assets').select('id, symbol, market_type, name'),
      supabase.from('trades').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'open'),
      supabase.from('trades').select('pnl').eq('user_id', user.id).eq('status', 'closed'),
    ]);
    setSnapshots((snapRes.data as { timestamp: string; total_value: number }[]) ?? []);
    setRecentSignals((sigRes.data as Signal[]) ?? []);
    if (assetRes.data) {
      const map: Record<string, Asset> = {};
      for (const a of assetRes.data as Asset[]) map[a.id] = a;
      setAssets(map);
    }
    setOpenCount(openRes.count ?? 0);
    setClosedTrades((closedRes.data as Trade[]) ?? []);
  }, [user]);

  useEffect(() => { loadDashboardData(); }, [loadDashboardData]);

  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0).length;
  const winRate = closedTrades.length > 0 ? Math.round((wins / closedTrades.length) * 100) : null;

  const refreshData = async () => {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('fetch-market-data', { method: 'POST', body: {} });
      if (fnError) throw new Error(fnError.message);
      setRefreshResult(data as RefreshResult);
    } catch (e) {
      setRefreshResult({ success: false, error: e instanceof Error ? e.message : 'Failed to refresh data' });
    } finally { setRefreshing(false); }
  };

  const generateSignals = async () => {
    setGenerating(true);
    setGenerateResult(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('generate-signals', { method: 'POST', body: {} });
      if (fnError) throw new Error(fnError.message);
      setGenerateResult(data as GenerateResult);
      await loadDashboardData();
      await refreshProfile();
    } catch (e) {
      setGenerateResult({ success: false, error: e instanceof Error ? e.message : 'Failed to generate signals' });
    } finally { setGenerating(false); }
  };

  const chartData = snapshots.map((s) => ({
    time: new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: s.total_value,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Welcome back, {profile?.display_name || 'Trader'}</h1>
          <p className="text-sm text-slate-400 mt-1">Here's your paper trading overview.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={refreshData} disabled={refreshing} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium hover:bg-emerald-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing…' : 'Refresh Data'}
          </button>
          <button onClick={generateSignals} disabled={generating} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 text-sm font-medium hover:bg-sky-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed">
            <Zap className={`w-4 h-4 ${generating ? 'animate-pulse' : ''}`} />
            {generating ? 'Generating…' : 'Generate Signals'}
          </button>
        </div>
      </div>

      {(refreshResult || generateResult) && (
        <div className="space-y-2">
          {refreshResult && (
            <div className={`flex items-start gap-2.5 text-sm rounded-lg px-4 py-3 border ${refreshResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
              {refreshResult.success ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{refreshResult.success ? `Updated ${refreshResult.inserted ?? 0} price snapshots` + (refreshResult.errors?.length ? ` (with ${refreshResult.errors.length} partial error(s))` : '') : refreshResult.error ?? 'Refresh failed'}</span>
            </div>
          )}
          {generateResult && (
            <div className={`flex items-start gap-2.5 text-sm rounded-lg px-4 py-3 border ${generateResult.success ? 'bg-sky-500/10 border-sky-500/30 text-sky-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
              {generateResult.success ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{generateResult.success ? `Generated ${generateResult.inserted ?? 0} new signals` + (generateResult.errors?.length ? ` (with ${generateResult.errors.length} partial error(s))` : '') : generateResult.error ?? 'Signal generation failed'}</span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={DollarSign} label="Virtual Capital" value={fmt(capital)} accent="emerald" />
        <StatCard icon={Activity} label="Open Positions" value={String(openCount)} accent="sky" />
        <StatCard icon={totalPnl >= 0 ? TrendingUp : TrendingDown} label="Total P&L" value={fmt(totalPnl)} accent={totalPnl >= 0 ? 'emerald' : 'rose'} />
        <StatCard icon={Trophy} label="Win Rate" value={winRate !== null ? `${winRate}%` : '—'} accent="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-white mb-4">Portfolio Value</h3>
          {chartData.length < 2 ? (
            <div className="h-48 flex items-center justify-center text-slate-600 text-sm">Not enough data yet — generate signals and run trades to see your portfolio chart</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }} labelStyle={{ color: '#94a3b8' }} formatter={(v) => [fmt(Number(v)), 'Value']} />
                <Line type="monotone" dataKey="value" stroke="#34d399" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#34d399' }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-white mb-4">Recent Signals</h3>
          {recentSignals.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-slate-600 text-sm">No signals yet</div>
          ) : (
            <div className="space-y-2.5">
              {recentSignals.map((sig) => {
                const asset = assets[sig.asset_id];
                const s = signalStyle(sig.signal_type);
                const Icon = s.icon;
                return (
                  <div key={sig.id} className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-lg ${s.bg} border ${s.border} flex items-center justify-center shrink-0`}>
                      <Icon className={`w-3.5 h-3.5 ${s.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-white">{asset?.symbol ?? '?'}</span>
                        <span className={`text-[10px] font-bold uppercase ${s.color}`}>{sig.signal_type}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 truncate">{new Date(sig.generated_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-1">
                        <div className="w-12 h-1 rounded-full bg-slate-700/50 overflow-hidden">
                          <div className={`h-full rounded-full ${sig.signal_type === 'buy' ? 'bg-emerald-400' : sig.signal_type === 'sell' ? 'bg-rose-400' : 'bg-slate-400'}`} style={{ width: `${sig.confidence_score}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-slate-300 tabular-nums">{sig.confidence_score}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  accent: 'emerald' | 'sky' | 'slate' | 'amber' | 'rose';
}) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-400',
    sky: 'text-sky-400',
    slate: 'text-slate-300',
    amber: 'text-amber-400',
    rose: 'text-rose-400',
  };
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className={`w-4 h-4 ${colors[accent]}`} />
        <p className="text-xs text-slate-400">{label}</p>
      </div>
      <p className={`text-xl font-bold ${colors[accent]}`}>{value}</p>
    </div>
  );
}

// ---- Signals Page ----

function signalStyle(type: string) {
  switch (type) {
    case 'buy':
      return { icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' };
    case 'sell':
      return { icon: TrendingDown, color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/30' };
    default:
      return { icon: Minus, color: 'text-slate-400', bg: 'bg-slate-700/30', border: 'border-slate-600/40' };
  }
}

export function SignalsPage() {
  const { user } = useAuth();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [accuracy, setAccuracy] = useState<Record<string, StrategyAccuracy>>({});
  const [pendingTrades, setPendingTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState<'short_term' | 'long_term'>('short_term');

  const loadSignals = useCallback(async () => {
    setLoading(true);
    const [sigRes, assetRes, pendingRes, accRes] = await Promise.all([
      supabase
        .from('signals')
        .select('id, strategy_id, asset_id, signal_type, confidence_score, reasoning_text, generated_at, signal_term, risk_note, recommended_confidence')
        .is('strategy_id', null)
        .eq('signal_term', term)
        .order('generated_at', { ascending: false })
        .limit(60),
      supabase.from('assets').select('id, symbol, market_type, name'),
      supabase
        .from('trades')
        .select('*')
        .eq('user_id', user!.id)
        .eq('status', 'pending')
        .order('opened_at', { ascending: false, nullsFirst: false }),
      supabase
        .from('strategy_accuracy')
        .select('id, asset_id, signal_term, lookback_days, win_rate_pct, avg_return_pct, total_signals_tested, calculated_at')
        .eq('signal_term', term),
    ]);

    if (assetRes.data) {
      const map: Record<string, Asset> = {};
      for (const a of assetRes.data as Asset[]) map[a.id] = a;
      setAssets(map);
    }
    if (accRes.data) {
      const amap: Record<string, StrategyAccuracy> = {};
      for (const a of accRes.data as StrategyAccuracy[]) amap[a.asset_id] = a;
      setAccuracy(amap);
    } else {
      setAccuracy({});
    }
    setSignals((sigRes.data as Signal[]) ?? []);
    setPendingTrades((pendingRes.data as Trade[]) ?? []);
    setLoading(false);
  }, [term, user]);

  useEffect(() => {
    loadSignals();
  }, [loadSignals]);

  const approveTrade = async (trade: Trade) => {
    await supabase
      .from('trades')
      .update({ status: 'open', opened_at: new Date().toISOString() })
      .eq('id', trade.id);
    loadSignals();
  };

  const rejectTrade = async (trade: Trade) => {
    await supabase
      .from('trades')
      .update({ status: 'cancelled', rejected_at: new Date().toISOString() })
      .eq('id', trade.id);
    loadSignals();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Signals</h1>
          <p className="text-sm text-slate-400 mt-1">
            Technical-analysis-based signals across all markets.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTerm('short_term')}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium border transition ${
              term === 'short_term'
                ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                : 'border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            Short Term
          </button>
          <button
            onClick={() => setTerm('long_term')}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium border transition ${
              term === 'long_term'
                ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                : 'border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            Long Term
          </button>
          <button
            onClick={loadSignals}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-white text-sm transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {pendingTrades.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Hand className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-amber-400">
              Pending Suggestions ({pendingTrades.length})
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {pendingTrades.map((t) => {
              const asset = assets[t.asset_id];
              const isLong = t.trade_type === 'long';
              return (
                <div
                  key={t.id}
                  className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
                >
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white text-sm">{asset?.symbol ?? '?'}</span>
                      <span className={`text-xs ${isLong ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {t.trade_type}
                      </span>
                    </div>
                    <span className="text-xs text-amber-400 font-medium">Pending</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                    <div>
                      <p className="text-slate-500">Entry</p>
                      <p className="text-slate-300 tabular-nums">{t.entry_price.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Stop</p>
                      <p className="text-rose-400/70 tabular-nums">{t.stop_loss?.toFixed(2) ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Target</p>
                      <p className="text-emerald-400/70 tabular-nums">{t.take_profit?.toFixed(2) ?? '—'}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => approveTrade(t)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Approve
                    </button>
                    <button
                      onClick={() => rejectTrade(t)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-medium hover:bg-rose-500/20 transition"
                    >
                      <X className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-5 h-5 text-slate-500 animate-spin" />
        </div>
      ) : signals.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center mb-4">
            <Radio className="w-6 h-6 text-slate-500" />
          </div>
          <p className="text-sm text-slate-400 max-w-sm">
            No signals generated yet. Click "Generate Signals" on the Dashboard to run the analysis.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {signals.map((sig) => {
            const asset = assets[sig.asset_id];
            const s = signalStyle(sig.signal_type);
            const Icon = s.icon;
            return (
              <div
                key={sig.id}
                className={`rounded-xl border ${s.border} ${s.bg} p-4`}
              >
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${s.color}`} />
                    <span className="font-semibold text-white text-sm">
                      {asset?.symbol ?? 'Unknown'}
                    </span>
                    <span className="text-xs text-slate-500 capitalize">
                      {asset?.market_type}
                    </span>
                  </div>
                  <span className={`text-xs font-bold uppercase tracking-wide ${s.color}`}>
                    {sig.signal_type}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="flex-1 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        sig.signal_type === 'buy'
                          ? 'bg-emerald-400'
                          : sig.signal_type === 'sell'
                          ? 'bg-rose-400'
                          : 'bg-slate-400'
                      }`}
                      style={{ width: `${sig.confidence_score}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-300 tabular-nums">
                    {sig.confidence_score}%
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {sig.reasoning_text}
                </p>
                {(() => {
                  const acc = accuracy[sig.asset_id];
                  if (!acc || acc.total_signals_tested === 0) return null;
                  return (
                    <div className="flex items-center gap-2 mt-2 px-2.5 py-1.5 rounded-lg bg-slate-800/40">
                      <Trophy className="w-3 h-3 text-slate-400 shrink-0" />
                      <p className="text-[11px] text-slate-400">
                        Historical win rate: <span className="font-semibold text-slate-300">{acc.win_rate_pct}%</span>
                        <span className="text-slate-600"> ({acc.total_signals_tested} signals, 90d)</span>
                      </p>
                    </div>
                  );
                })()}
                <p className="text-[10px] text-slate-600 mt-2">
                  {new Date(sig.generated_at).toLocaleString()}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TradeHistoryPage() {
  return <TradeHistoryPageImpl />;
}

export function StrategiesPage() {
  return <StrategiesPageImpl />;
}

export function PortfolioPage() {
  return <PortfolioPageImpl />;
}

export function SettingsPage() {
  return <SettingsPageImpl />;
}

export function renderPage(id: PageId) {
  switch (id) {
    case 'dashboard':
      return <DashboardPage />;
    case 'signals':
      return <SignalsPage />;
    case 'history':
      return <TradeHistoryPage />;
    case 'strategies':
      return <StrategiesPage />;
    case 'portfolio':
      return <PortfolioPage />;
    case 'settings':
      return <SettingsPage />;
    case 'admin':
      return <AdminAssetsPage />;
  }
}
