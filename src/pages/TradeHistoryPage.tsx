import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Trade, Asset } from '@/lib/types';
import { History, TrendingUp, TrendingDown, Clock, Globe, Coins, Landmark, Download } from 'lucide-react';

// Quotes/escapes a single CSV field per RFC 4180 — wrap in quotes and escape
// embedded quotes whenever the value could otherwise break column alignment.
function csvField(value: string | number | null): string {
  const str = value === null ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function exportTradesToCsv(trades: Trade[], assets: Record<string, Asset>) {
  const headers = [
    'Asset', 'Market', 'Type', 'Status', 'Mode', 'Entry Price', 'Exit Price',
    'Quantity', 'Stop Loss', 'Take Profit', 'P&L', 'Opened At', 'Closed At',
  ];

  const rows = trades.map((t) => {
    const asset = assets[t.asset_id];
    return [
      csvField(asset?.symbol ?? '?'),
      csvField(asset?.market_type ?? ''),
      csvField(t.trade_type),
      csvField(t.status),
      csvField(t.execution_mode ?? 'paper'),
      csvField(t.entry_price),
      csvField(t.exit_price),
      csvField(t.quantity),
      csvField(t.stop_loss),
      csvField(t.take_profit),
      csvField(t.status === 'closed' ? t.pnl : ''),
      csvField(t.opened_at ?? ''),
      csvField(t.closed_at ?? ''),
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `trademind-trades-${dateStr}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function TradeHistoryPage() {
  const { user } = useAuth();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'closed' | 'pending'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('trades')
      .select('*')
      .eq('user_id', user!.id)
      .order('opened_at', { ascending: false, nullsFirst: false });

    if (filter !== 'all') query = query.eq('status', filter);

    const [tradeRes, assetRes] = await Promise.all([
      query,
      supabase.from('assets').select('id, symbol, market_type, name'),
    ]);

    setTrades((tradeRes.data as Trade[]) ?? []);
    if (assetRes.data) {
      const map: Record<string, Asset> = {};
      for (const a of assetRes.data as Asset[]) map[a.id] = a;
      setAssets(map);
    }
    setLoading(false);
  }, [user, filter]);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates: a new trade opening, closing, or its P&L ticking as price
  // moves now shows up here immediately instead of only after switching
  // tabs or refreshing — matches the same live pattern used on Dashboard.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('trade-history-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trades', filter: `user_id=eq.${user.id}` },
        () => {
          load();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, load]);

  const fmt = (n: number | null) =>
    n !== null
      ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
      : '—';

  const fmtPrice = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

  const statusColor = (s: string) => {
    switch (s) {
      case 'open': return 'text-sky-400 bg-sky-500/10 border-sky-500/30';
      case 'closed': return 'text-slate-400 bg-slate-700/30 border-slate-600/40';
      case 'pending': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'cancelled': return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
      default: return 'text-slate-400 bg-slate-700/30 border-slate-600/40';
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Trade History</h1>
          <p className="text-sm text-slate-400 mt-1">All your paper trades — open, closed, and pending.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', 'open', 'pending', 'closed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize border transition ${
                filter === f
                  ? 'bg-slate-700 text-white border-slate-600'
                  : 'border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
          <button
            onClick={() => exportTradesToCsv(trades, assets)}
            disabled={trades.length === 0}
            className="ml-1.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-600/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin" />
        </div>
      ) : trades.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center mb-4">
            <History className="w-6 h-6 text-slate-500" />
          </div>
          <p className="text-sm text-slate-400 max-w-sm">
            No trades yet. Create a strategy and generate signals to start paper trading.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900/60 text-slate-500 text-xs uppercase">
                <th className="text-left px-4 py-3 font-medium">Asset</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-right px-4 py-3 font-medium">Entry</th>
                <th className="text-right px-4 py-3 font-medium">Exit</th>
                <th className="text-right px-4 py-3 font-medium">Qty</th>
                <th className="text-right px-4 py-3 font-medium">SL</th>
                <th className="text-right px-4 py-3 font-medium">TP</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-center px-4 py-3 font-medium">Mode</th>
                <th className="text-right px-4 py-3 font-medium">P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {trades.map((t) => {
                const asset = assets[t.asset_id];
                const isLong = t.trade_type === 'long';
                return (
                  <tr key={t.id} className="hover:bg-slate-800/30 transition">
                    <td className="px-4 py-3 font-medium text-white">{asset?.symbol ?? '?'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs ${isLong ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isLong ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {t.trade_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{fmtPrice(t.entry_price)}</td>
                    <td className="px-4 py-3 text-right text-slate-300 tabular-nums">
                      {t.exit_price !== null ? fmtPrice(t.exit_price) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 tabular-nums">{t.quantity.toFixed(4)}</td>
                    <td className="px-4 py-3 text-right text-rose-400/70 tabular-nums">
                      {t.stop_loss !== null ? fmtPrice(t.stop_loss) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-400/70 tabular-nums">
                      {t.take_profit !== null ? fmtPrice(t.take_profit) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${statusColor(t.status)}`}>
                        {t.status === 'pending' && <Clock className="w-2.5 h-2.5" />}
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {t.execution_mode === 'testnet_live' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border border-violet-500/30 bg-violet-500/10 text-violet-400">
                          <Globe className="w-2.5 h-2.5" />
                          TESTNET
                        </span>
                      ) : t.execution_mode === 'coindcx_live' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-400">
                          <Coins className="w-2.5 h-2.5" />
                          COINDCX
                        </span>
                      ) : t.execution_mode === 'fivepaisa_live' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border border-rose-500/30 bg-rose-500/10 text-rose-400">
                          <Landmark className="w-2.5 h-2.5" />
                          5PAISA
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border border-slate-600/40 bg-slate-700/30 text-slate-400">
                          PAPER
                        </span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${
                      t.pnl > 0 ? 'text-emerald-400' : t.pnl < 0 ? 'text-rose-400' : 'text-slate-400'
                    }`}>
                      {t.status === 'closed' ? fmt(t.pnl) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
