import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Trade, Asset, PortfolioSnapshot } from '@/lib/types';
import { Briefcase, TrendingUp, TrendingDown, DollarSign, Activity, Globe, Sparkles } from 'lucide-react';

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
