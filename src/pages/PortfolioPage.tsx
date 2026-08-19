import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Trade, Asset, PortfolioSnapshot } from '@/lib/types';
import { Briefcase, TrendingUp, TrendingDown, DollarSign, Activity, Globe, Sparkles, Gauge, ArrowDownRight, Flame } from 'lucide-react';

// ---- Portfolio analytics: Sharpe ratio, max drawdown, win/loss streaks ----
// All computed client-side from the trades/snapshots already being fetched —
// no new tables or edge functions needed.

interface PortfolioAnalytics {
  sharpeRatio: number | null;
  maxDrawdownPct: number | null;
  maxDrawdownAbs: number | null;
  currentStreak: { type: 'win' | 'loss' | null; count: number };
  longestWinStreak: number;
  longestLossStreak: number;
  totalPnl: number;
  profitFactor: number | null;
}

function computeAnalytics(closedTrades: Trade[], snapshots: PortfolioSnapshot[]): PortfolioAnalytics {
  // Sharpe ratio — from per-trade returns (%), annualized isn't meaningful
  // here since trade frequency varies wildly, so this reports the raw
  // risk-adjusted ratio (mean return / stdev of returns) across closed trades.
  // Needs at least a few trades or the stdev is noise.
  const returns = closedTrades
    .map((t) => {
      const base = t.entry_price * t.quantity;
      return base > 0 ? t.pnl / base : 0;
    })
    .filter((r) => Number.isFinite(r));

  let sharpeRatio: number | null = null;
  if (returns.length >= 5) {
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const stdev = Math.sqrt(variance);
    sharpeRatio = stdev > 0 ? mean / stdev : null;
  }

  // Max drawdown — from the portfolio value snapshot history (oldest to
  // newest), the largest peak-to-trough decline observed.
  let maxDrawdownPct: number | null = null;
  let maxDrawdownAbs: number | null = null;
  if (snapshots.length >= 2) {
    const chronological = [...snapshots].reverse().map((s) => s.total_value);
    let peak = chronological[0];
    let worstPct = 0;
    let worstAbs = 0;
    for (const value of chronological) {
      if (value > peak) peak = value;
      const drawdownAbs = peak - value;
      const drawdownPct = peak > 0 ? drawdownAbs / peak : 0;
      if (drawdownPct > worstPct) {
        worstPct = drawdownPct;
        worstAbs = drawdownAbs;
      }
    }
    maxDrawdownPct = worstPct;
    maxDrawdownAbs = worstAbs;
  }

  // Win/loss streaks — walk closed trades in chronological order (oldest
  // first) since that's the order the streak actually happened in.
  const chronologicalTrades = [...closedTrades]
    .filter((t) => t.closed_at)
    .sort((a, b) => new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime());

  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let runType: 'win' | 'loss' | null = null;
  let runCount = 0;

  for (const t of chronologicalTrades) {
    const isWin = t.pnl > 0;
    const thisType: 'win' | 'loss' = isWin ? 'win' : 'loss';
    if (thisType === runType) {
      runCount += 1;
    } else {
      runType = thisType;
      runCount = 1;
    }
    if (thisType === 'win') longestWinStreak = Math.max(longestWinStreak, runCount);
    else longestLossStreak = Math.max(longestLossStreak, runCount);
  }

  const currentStreak = { type: runType, count: runCount };

  const totalPnl = closedTrades.reduce((s, t) => s + t.pnl, 0);
  const grossProfit = closedTrades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(closedTrades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;

  return {
    sharpeRatio,
    maxDrawdownPct,
    maxDrawdownAbs,
    currentStreak,
    longestWinStreak,
    longestLossStreak,
    totalPnl,
    profitFactor,
  };
}

export function PortfolioPage() {
  const { user, profile } = useAuth();
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [closedTrades, setClosedTrades] = useState<Trade[]>([]);
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [tradeRes, closedRes, assetRes, snapRes] = await Promise.all([
      supabase
        .from('trades')
        .select('*')
        .eq('user_id', user!.id)
        .eq('status', 'open')
        .order('opened_at', { ascending: false }),
      supabase
        .from('trades')
        .select('*')
        .eq('user_id', user!.id)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(200),
      supabase.from('assets').select('id, symbol, market_type, name'),
      supabase
        .from('portfolio_snapshots')
        .select('*')
        .eq('user_id', user!.id)
        .order('timestamp', { ascending: false })
        .limit(30),
    ]);

    setOpenTrades((tradeRes.data as Trade[]) ?? []);
    setClosedTrades((closedRes.data as Trade[]) ?? []);
    if (assetRes.data) {
      const map: Record<string, Asset> = {};
      for (const a of assetRes.data as Asset[]) map[a.id] = a;
      setAssets(map);
    }
    setSnapshots((snapRes.data as PortfolioSnapshot[]) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

  const capital = profile?.virtual_capital ?? 0;
  const openCount = openTrades.length;

  // Growth projection — uses actual trade history (win rate + average return per
  // trade) to project forward, rather than assuming any fixed rate. Needs a
  // minimum sample size before it says anything, otherwise it's just noise.
  const wins = closedTrades.filter((t) => t.pnl > 0).length;
  const totalClosed = closedTrades.length;
  const winRate = totalClosed > 0 ? wins / totalClosed : 0;
  const avgPnlPct =
    totalClosed > 0
      ? closedTrades.reduce((sum, t) => {
          const base = t.entry_price * t.quantity;
          return sum + (base > 0 ? t.pnl / base : 0);
        }, 0) / totalClosed
      : 0;
  // Rough trade frequency from the observed history (trades per day), capped
  // to avoid wild extrapolation from a tiny time window.
  let tradesPerDay = 0;
  if (totalClosed >= 2) {
    const times = closedTrades
      .map((t) => (t.closed_at ? new Date(t.closed_at).getTime() : null))
      .filter((t): t is number => t !== null)
      .sort((a, b) => a - b);
    const spanDays = Math.max((times[times.length - 1] - times[0]) / 86400000, 1);
    tradesPerDay = Math.min(totalClosed / spanDays, 10);
  }
  const hasEnoughHistory = totalClosed >= 5 && tradesPerDay > 0;
  const projectFor = (days: number) => {
    if (!hasEnoughHistory) return null;
    const expectedTrades = tradesPerDay * days;
    const growthFactor = Math.pow(1 + avgPnlPct, expectedTrades);
    return capital * growthFactor;
  };

  // Simple sparkline from snapshots
  const sparkValues = snapshots.length > 0
    ? snapshots.map((s) => s.total_value).reverse()
    : [capital];

  const analytics = useMemo(
    () => computeAnalytics(closedTrades, snapshots),
    [closedTrades, snapshots],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Portfolio</h1>
        <p className="text-sm text-slate-400 mt-1">
          Track your virtual capital, open positions, and performance over time.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={DollarSign} label="Virtual Capital" value={fmt(capital)} accent="emerald" />
            <StatCard icon={Activity} label="Open Positions" value={String(openCount)} accent="sky" />
            <StatCard
              icon={snapshots.length > 0 && snapshots[0].unrealized_pnl >= 0 ? TrendingUp : TrendingDown}
              label="Unrealized P&L"
              value={snapshots.length > 0 ? fmt(snapshots[0].unrealized_pnl) : '—'}
              accent={snapshots.length > 0 && snapshots[0].unrealized_pnl >= 0 ? 'emerald' : 'rose'}
            />
            <StatCard
              icon={Briefcase}
              label="Total Value"
              value={snapshots.length > 0 ? fmt(snapshots[0].total_value) : fmt(capital)}
              accent="slate"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-white mb-4">Portfolio Value Over Time</h3>
              <Sparkline values={sparkValues} />
            </div>

            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-white mb-4">Risk Settings</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Max Concurrent Positions</span>
                  <span className="text-white font-medium">{profile?.max_concurrent_positions ?? 5}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Daily Loss Limit</span>
                  <span className="text-white font-medium">{profile?.daily_loss_limit_pct ?? 5}%</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Risk Tolerance</span>
                  <span className="text-white font-medium capitalize">{profile?.risk_tolerance ?? 'medium'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-white">Growth Projection</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Based on your own trade history — not a guarantee. Past results don't predict future ones.
            </p>
            {!hasEnoughHistory ? (
              <p className="text-sm text-slate-500 py-4">
                Close at least 5 trades to unlock a projection based on your actual win rate and average
                return per trade.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-slate-500">Starting Capital</p>
                    <p className="text-sm font-semibold text-white">{fmt(profile?.starting_capital ?? capital)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Win Rate</p>
                    <p className="text-sm font-semibold text-white">{(winRate * 100).toFixed(0)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Avg Return / Trade</p>
                    <p className={`text-sm font-semibold ${avgPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {avgPnlPct >= 0 ? '+' : ''}{(avgPnlPct * 100).toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Trade Frequency</p>
                    <p className="text-sm font-semibold text-white">~{tradesPerDay.toFixed(1)}/day</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[7, 30, 90].map((days) => {
                    const projected = projectFor(days);
                    const pct = projected !== null ? ((projected - capital) / capital) * 100 : 0;
                    return (
                      <div key={days} className="bg-slate-800/40 rounded-xl p-3 text-center">
                        <p className="text-xs text-slate-500 mb-1">{days} days</p>
                        <p className="text-sm font-semibold text-white">{projected !== null ? fmt(projected) : '—'}</p>
                        <p className={`text-xs mt-0.5 ${pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                        </p>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <Gauge className="w-4 h-4 text-sky-400" />
              <h3 className="text-sm font-semibold text-white">Performance Analytics</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Risk-adjusted performance metrics computed from your closed trade history.
            </p>
            {totalClosed < 5 ? (
              <p className="text-sm text-slate-500 py-4">
                Close at least 5 trades to unlock Sharpe ratio and streak analytics.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                <AnalyticStat
                  label="Sharpe Ratio"
                  value={analytics.sharpeRatio !== null ? analytics.sharpeRatio.toFixed(2) : '—'}
                  hint="Return / volatility, per trade"
                  tone={
                    analytics.sharpeRatio === null
                      ? 'slate'
                      : analytics.sharpeRatio >= 0.5
                        ? 'emerald'
                        : analytics.sharpeRatio >= 0
                          ? 'amber'
                          : 'rose'
                  }
                  icon={Gauge}
                />
                <AnalyticStat
                  label="Max Drawdown"
                  value={
                    analytics.maxDrawdownPct !== null
                      ? `-${(analytics.maxDrawdownPct * 100).toFixed(1)}%`
                      : '—'
                  }
                  hint={analytics.maxDrawdownAbs !== null ? fmt(analytics.maxDrawdownAbs) : 'Not enough history'}
                  tone={
                    analytics.maxDrawdownPct === null
                      ? 'slate'
                      : analytics.maxDrawdownPct <= 0.1
                        ? 'emerald'
                        : analytics.maxDrawdownPct <= 0.25
                          ? 'amber'
                          : 'rose'
                  }
                  icon={ArrowDownRight}
                />
                <AnalyticStat
                  label="Profit Factor"
                  value={analytics.profitFactor !== null ? analytics.profitFactor.toFixed(2) : '—'}
                  hint="Gross profit / gross loss"
                  tone={
                    analytics.profitFactor === null
                      ? 'slate'
                      : analytics.profitFactor >= 1.5
                        ? 'emerald'
                        : analytics.profitFactor >= 1
                          ? 'amber'
                          : 'rose'
                  }
                  icon={TrendingUp}
                />
                <AnalyticStat
                  label="Current Streak"
                  value={
                    analytics.currentStreak.type
                      ? `${analytics.currentStreak.count} ${analytics.currentStreak.type === 'win' ? 'win' : 'loss'}${analytics.currentStreak.count > 1 ? 's' : ''}`
                      : '—'
                  }
                  hint={`Best: ${analytics.longestWinStreak}W / ${analytics.longestLossStreak}L`}
                  tone={
                    analytics.currentStreak.type === 'win'
                      ? 'emerald'
                      : analytics.currentStreak.type === 'loss'
                        ? 'rose'
                        : 'slate'
                  }
                  icon={Flame}
                />
                <AnalyticStat
                  label="Total Realized P&L"
                  value={fmt(analytics.totalPnl)}
                  hint={`Across ${totalClosed} closed trades`}
                  tone={analytics.totalPnl >= 0 ? 'emerald' : 'rose'}
                  icon={DollarSign}
                />
              </div>
            )}
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-white mb-4">Open Positions</h3>
            {openTrades.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">No open positions.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 text-xs uppercase">
                      <th className="text-left pb-2 font-medium">Asset</th>
                      <th className="text-left pb-2 font-medium">Type</th>
                      <th className="text-right pb-2 font-medium">Entry</th>
                      <th className="text-right pb-2 font-medium">Qty</th>
                      <th className="text-right pb-2 font-medium">Stop Loss</th>
                      <th className="text-right pb-2 font-medium">Take Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {openTrades.map((t) => {
                      const asset = assets[t.asset_id];
                      return (
                        <tr key={t.id}>
                          <td className="py-3 font-medium text-white">{asset?.symbol ?? '?'}</td>
                          <td className="py-3">
                            <span className={t.trade_type === 'long' ? 'text-emerald-400' : 'text-rose-400'}>
                              {t.trade_type}
                            </span>
                          </td>
                          <td className="py-3 text-right text-slate-300 tabular-nums">{t.entry_price.toFixed(2)}</td>
                          <td className="py-3 text-right text-slate-400 tabular-nums">{t.quantity.toFixed(4)}</td>
                          <td className="py-3 text-right text-rose-400/70 tabular-nums">{t.stop_loss?.toFixed(2) ?? '—'}</td>
                          <td className="py-3 text-right text-emerald-400/70 tabular-nums">{t.take_profit?.toFixed(2) ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
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
  accent: 'emerald' | 'sky' | 'slate' | 'rose';
}) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-400',
    sky: 'text-sky-400',
    slate: 'text-slate-300',
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

function AnalyticStat({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  hint: string;
  tone: 'emerald' | 'amber' | 'rose' | 'slate';
}) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    rose: 'text-rose-400',
    slate: 'text-slate-300',
  };
  return (
    <div className="bg-slate-800/40 rounded-xl p-3.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={`w-3.5 h-3.5 ${colors[tone]}`} />
        <p className="text-xs text-slate-500">{label}</p>
      </div>
      <p className={`text-lg font-bold ${colors[tone]}`}>{value}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return (
      <div className="h-40 flex items-center justify-center text-slate-600 text-sm">
        Not enough data yet
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 100;
  const height = 100;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  const isUp = values[values.length - 1] >= values[0];
  const strokeColor = isUp ? '#34d399' : '#fb7185';

  return (
    <div className="h-40 flex items-end">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
        <polyline
          points={points}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
