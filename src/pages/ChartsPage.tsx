import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import type { Asset } from '@/lib/types';
import { CandlestickChart } from '@/components/CandlestickChart';
import { LineChart as LineChartIcon, TrendingUp, TrendingDown } from 'lucide-react';

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const TIMEFRAMES = [
  { id: 'raw', label: 'Raw', groupSize: 1 },
  { id: '15m', label: '15m', groupSize: 8 }, // ~8 x 2min snapshots
  { id: '1h', label: '1h', groupSize: 30 },
  { id: '4h', label: '4h', groupSize: 120 },
] as const;

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

export function ChartsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]['id']>('15m');
  const [rawCandles, setRawCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAssets = useCallback(async () => {
    const { data } = await supabase
      .from('assets')
      .select('id, symbol, market_type, name, fivepaisa_scrip_code')
      .order('market_type')
      .order('symbol');
    const list = (data as Asset[]) ?? [];
    setAssets(list);
    if (list.length > 0 && !selectedAssetId) {
      setSelectedAssetId(list[0].id);
    }
  }, [selectedAssetId]);

  const loadCandles = useCallback(async (assetId: string) => {
    if (!assetId) return;
    setLoading(true);
    const { data } = await supabase
      .from('market_data')
      .select('timestamp, open, high, low, close, volume')
      .eq('asset_id', assetId)
      .order('timestamp', { ascending: true })
      .limit(500);
    setRawCandles((data as Candle[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    if (selectedAssetId) loadCandles(selectedAssetId);
    const interval = setInterval(() => {
      if (selectedAssetId) loadCandles(selectedAssetId);
    }, 60000); // auto-refresh every minute — matches the 2-min collection cadence closely enough
    return () => clearInterval(interval);
  }, [selectedAssetId, loadCandles]);

  const activeTimeframe = TIMEFRAMES.find((t) => t.id === timeframe) ?? TIMEFRAMES[0];
  const displayCandles = useMemo(
    () => resample(rawCandles, activeTimeframe.groupSize).slice(-80), // last 80 bars, readable on screen
    [rawCandles, activeTimeframe],
  );

  const selectedAsset = assets.find((a) => a.id === selectedAssetId);
  const lastCandle = displayCandles[displayCandles.length - 1];
  const firstCandle = displayCandles[0];
  const changePct = lastCandle && firstCandle && firstCandle.open > 0
    ? ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100
    : 0;

  const grouped = assets.reduce<Record<string, Asset[]>>((acc, a) => {
    (acc[a.market_type] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div className="p-6 max-w-5xl space-y-5">
      <div className="flex items-center gap-2">
        <LineChartIcon className="w-5 h-5 text-emerald-400" />
        <h1 className="text-lg font-semibold text-white">Charts</h1>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selectedAssetId}
          onChange={(e) => setSelectedAssetId(e.target.value)}
          className="bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
        >
          {Object.entries(grouped).map(([marketType, list]) => (
            <optgroup key={marketType} label={marketType.toUpperCase()}>
              {list.map((a) => (
                <option key={a.id} value={a.id}>{a.symbol} — {a.name}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <div className="flex gap-1 bg-slate-800/40 rounded-lg p-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              onClick={() => setTimeframe(tf.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                timeframe === tf.id
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {lastCandle && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-lg font-semibold text-white">
              {lastCandle.close >= 1000 ? lastCandle.close.toFixed(2) : lastCandle.close.toFixed(6)}
            </span>
            <span className={`inline-flex items-center gap-1 text-sm font-medium ${changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {changePct >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
        {loading ? (
          <div className="h-96 flex items-center justify-center text-sm text-slate-500">Loading…</div>
        ) : (
          <CandlestickChart candles={displayCandles} height={420} />
        )}
      </div>

      <p className="text-xs text-slate-600">
        Showing {selectedAsset?.symbol ?? '—'} · {displayCandles.length} bars on the {activeTimeframe.label} timeframe,
        built from collected price snapshots (raw data arrives roughly every 2 minutes). Refreshes automatically.
      </p>
    </div>
  );
}
