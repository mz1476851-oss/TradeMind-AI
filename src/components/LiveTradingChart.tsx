import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Trade, Asset } from '@/lib/types';
import { CandlestickChart } from '@/components/CandlestickChart';
import { Radio, TrendingUp, TrendingDown } from 'lucide-react';

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function resample(candles: Candle[], groupSize: number): Candle[] {
  if (groupSize <= 1) return candles;
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += groupSize) {
    const group = candles.slice(i, i + groupSize);
    if (group.length === 0) continue;
    out.push({
      timestamp: group[group.length - 1].timestamp,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    });
  }
  return out;
}

const MODE_LABELS: Record<string, string> = {
  paper: 'PAPER',
  testnet_live: 'BINANCE TESTNET',
  coindcx_live: 'COINDCX LIVE',
  fivepaisa_live: '5PAISA LIVE',
};

export function LiveTradingChart() {
  const { user } = useAuth();
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    const [tradeRes, assetRes] = await Promise.all([
      supabase
        .from('trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'open')
        .order('opened_at', { ascending: false }),
      supabase.from('assets').select('id, symbol, market_type, name, fivepaisa_scrip_code'),
    ]);
    const trades = (tradeRes.data as Trade[]) ?? [];
    setOpenTrades(trades);
    if (assetRes.data) {
      const map: Record<string, Asset> = {};
      for (const a of assetRes.data as Asset[]) map[a.id] = a;
      setAssets(map);
    }
    setSelectedTradeId((prev) => (prev && trades.some((t) => t.id === prev) ? prev : trades[0]?.id ?? null));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // catch newly opened/closed trades quickly
    return () => clearInterval(interval);
  }, [load]);

  const selectedTrade = openTrades.find((t) => t.id === selectedTradeId);

  useEffect(() => {
    if (!selectedTrade) {
      setCandles([]);
      return;
    }
    let cancelled = false;
    const loadCandles = async () => {
      const { data } = await supabase
        .from('market_data')
        .select('timestamp, open, high, low, close, volume')
        .eq('asset_id', selectedTrade.asset_id)
        .order('timestamp', { ascending: true })
        .limit(500);
      if (!cancelled) setCandles((data as Candle[]) ?? []);
    };
    loadCandles();
    const interval = setInterval(loadCandles, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedTrade?.asset_id]);

  const displayCandles = useMemo(() => resample(candles, 8).slice(-70), [candles]); // ~15min bars, ~70 visible

  const asset = selectedTrade ? assets[selectedTrade.asset_id] : null;

  const overlays = selectedTrade
    ? [
        { price: selectedTrade.entry_price, label: 'Entry', color: '#38bdf8' },
        ...(selectedTrade.stop_loss ? [{ price: selectedTrade.stop_loss, label: 'SL', color: '#fb7185' }] : []),
        ...(selectedTrade.take_profit ? [{ price: selectedTrade.take_profit, label: 'TP', color: '#34d399' }] : []),
      ]
    : [];

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">Live Trading</h3>
          {openTrades.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {openTrades.length} active
            </span>
          )}
        </div>

        {openTrades.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            {openTrades.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTradeId(t.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                  selectedTradeId === t.id
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {assets[t.asset_id]?.symbol ?? '—'}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-96 flex items-center justify-center text-sm text-slate-500">Loading…</div>
      ) : !selectedTrade ? (
        <div className="h-64 flex flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-slate-400">No active position right now.</p>
          <p className="text-xs text-slate-600">
            The bot is watching the market — this chart will show your live position as soon as a trade opens.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="text-base font-semibold text-white">{asset?.symbol}</span>
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
              selectedTrade.trade_type === 'long'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
            }`}>
              {selectedTrade.trade_type === 'long' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {selectedTrade.trade_type.toUpperCase()}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-400">
              {MODE_LABELS[selectedTrade.execution_mode] ?? selectedTrade.execution_mode}
            </span>
            <span className="text-xs text-slate-500 ml-auto">
              Entry {selectedTrade.entry_price >= 1000 ? selectedTrade.entry_price.toFixed(2) : selectedTrade.entry_price.toFixed(6)} · Qty {selectedTrade.quantity}
            </span>
          </div>
          <CandlestickChart candles={displayCandles} height={340} overlays={overlays} />
        </>
      )}
    </div>
  );
}
