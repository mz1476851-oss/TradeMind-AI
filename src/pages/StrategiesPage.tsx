import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Strategy, Asset, MarketType, StrategyType, ExecutionTarget } from '@/lib/types';
import {
  Plus,
  Trash2,
  Power,
  Zap,
  Hand,
  X,
  Settings2,
  Check,
  Globe,
  FlaskConical,
  Coins,
  Landmark,
} from 'lucide-react';

const MARKET_OPTIONS: MarketType[] = ['stocks', 'crypto', 'forex'];
const TYPE_OPTIONS: { id: StrategyType; label: string }[] = [
  { id: 'short_term', label: 'Short Term' },
  { id: 'long_term', label: 'Long Term' },
];

export function StrategiesPage() {
  const { user } = useAuth();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [stratRes, assetRes] = await Promise.all([
      supabase
        .from('strategies')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false }),
      supabase.from('assets').select('id, symbol, market_type, name').order('symbol'),
    ]);
    setStrategies((stratRes.data as Strategy[]) ?? []);
    setAssets((assetRes.data as Asset[]) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (s: Strategy) => {
    await supabase
      .from('strategies')
      .update({ is_active: !s.is_active })
      .eq('id', s.id);
    load();
  };

  const toggleAutoTrade = async (s: Strategy) => {
    await supabase
      .from('strategies')
      .update({ auto_trade: !s.auto_trade })
      .eq('id', s.id);
    load();
  };

  const deleteStrategy = async (id: string) => {
    await supabase.from('strategies').delete().eq('id', id);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Strategies</h1>
          <p className="text-sm text-slate-400 mt-1">
            Create trading strategies with automated or manual execution.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium hover:bg-emerald-500/20 transition"
        >
          <Plus className="w-4 h-4" />
          New Strategy
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin" />
        </div>
      ) : strategies.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center mb-4">
            <Settings2 className="w-6 h-6 text-slate-500" />
          </div>
          <p className="text-sm text-slate-400 max-w-sm">
            No strategies yet. Create one to start generating signals and paper trades.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {strategies.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              assets={assets}
              onToggleActive={() => toggleActive(s)}
              onToggleAutoTrade={() => toggleAutoTrade(s)}
              onDelete={() => deleteStrategy(s.id)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <StrategyForm
          assets={assets}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function StrategyCard({
  strategy,
  assets,
  onToggleActive,
  onToggleAutoTrade,
  onDelete,
}: {
  strategy: Strategy;
  assets: Asset[];
  onToggleActive: () => void;
  onToggleAutoTrade: () => void;
  onDelete: () => void;
}) {
  const watchedAssets = assets.filter((a) =>
    strategy.watched_asset_ids.includes(a.id)
  );
  const marketLabel =
    strategy.watched_markets.length > 0
      ? strategy.watched_markets.join(', ')
      : 'All markets';

  return (
    <div
      className={`rounded-2xl border p-5 transition ${
        strategy.is_active
          ? 'bg-slate-900/60 border-slate-700'
          : 'bg-slate-900/30 border-slate-800 opacity-60'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-white">{strategy.name}</h3>
          <p className="text-xs text-slate-500 mt-0.5 capitalize">
            {strategy.type.replace('_', ' ')} · {marketLabel}
          </p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={onToggleActive}
            className={`p-1.5 rounded-lg transition ${
              strategy.is_active
                ? 'text-emerald-400 hover:bg-emerald-500/10'
                : 'text-slate-500 hover:bg-slate-800'
            }`}
            title={strategy.is_active ? 'Active' : 'Inactive'}
          >
            <Power className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-slate-800/40 rounded-lg px-3 py-2">
          <p className="text-[10px] text-slate-500 uppercase">Risk/Trade</p>
          <p className="text-sm font-semibold text-white">{strategy.risk_per_trade_pct}%</p>
        </div>
        <div className="bg-slate-800/40 rounded-lg px-3 py-2">
          <p className="text-[10px] text-slate-500 uppercase">Min Confidence</p>
          <p className="text-sm font-semibold text-white">{strategy.confidence_threshold}%</p>
        </div>
        <div className="bg-slate-800/40 rounded-lg px-3 py-2">
          <p className="text-[10px] text-slate-500 uppercase">Mode</p>
          <p className={`text-sm font-semibold flex items-center gap-1 ${strategy.auto_trade ? 'text-sky-400' : 'text-amber-400'}`}>
            {strategy.auto_trade ? <Zap className="w-3 h-3" /> : <Hand className="w-3 h-3" />}
            {strategy.auto_trade ? 'Auto' : 'Manual'}
          </p>
        </div>
      </div>

      {watchedAssets.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {watchedAssets.map((a) => (
            <span
              key={a.id}
              className="text-xs px-2 py-0.5 rounded-full bg-slate-800/60 border border-slate-700 text-slate-400"
            >
              {a.symbol}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] text-slate-500 uppercase">Target</span>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
          strategy.execution_target === 'testnet_live'
            ? 'border-violet-500/30 bg-violet-500/10 text-violet-400'
            : strategy.execution_target === 'coindcx_live'
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
            : strategy.execution_target === 'fivepaisa_live'
            ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
            : 'border-slate-700 bg-slate-800/40 text-slate-400'
        }`}>
          {strategy.execution_target === 'testnet_live'
            ? 'Binance Testnet'
            : strategy.execution_target === 'coindcx_live'
            ? 'CoinDCX (Live)'
            : strategy.execution_target === 'fivepaisa_live'
            ? '5paisa (Live)'
            : 'Paper (Simulated)'}
        </span>
      </div>

      <button
        onClick={onToggleAutoTrade}
        className={`w-full py-2 rounded-lg text-sm font-medium border transition ${
          strategy.auto_trade
            ? 'bg-sky-500/10 border-sky-500/30 text-sky-400 hover:bg-sky-500/20'
            : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-white'
        }`}
      >
        {strategy.auto_trade ? 'Auto-trade ON (click to switch to manual)' : 'Manual approval (click to enable auto-trade)'}
      </button>
    </div>
  );
}

function StrategyForm({
  assets,
  onClose,
  onSaved,
}: {
  assets: Asset[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [type, setType] = useState<StrategyType>('short_term');
  const [riskPct, setRiskPct] = useState('1.5');
  const [confidence, setConfidence] = useState('60');
  const [autoTrade, setAutoTrade] = useState(false);
  const [executionTarget, setExecutionTarget] = useState<ExecutionTarget>('paper');
  const [trailingStopPct, setTrailingStopPct] = useState('');
  const [watchedMarkets, setWatchedMarkets] = useState<MarketType[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleMarket = (m: MarketType) => {
    setWatchedMarkets((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );
  };

  const toggleAsset = (id: string) => {
    setSelectedAssetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const submit = async () => {
    if (!name.trim()) {
      setError('Strategy name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: dbError } = await supabase.from('strategies').insert({
      user_id: user!.id,
      name: name.trim(),
      type,
      indicators_used: ['RSI', 'MACD', 'EMA', 'SMA', 'ATR'],
      risk_per_trade_pct: parseFloat(riskPct) || 1.5,
      confidence_threshold: parseFloat(confidence) || 60,
      auto_trade: autoTrade,
      is_active: true,
      watched_markets: watchedMarkets,
      watched_asset_ids: selectedAssetIds,
      execution_target: executionTarget,
      trailing_stop_pct: trailingStopPct.trim() ? parseFloat(trailingStopPct) : null,
    });
    setBusy(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    onSaved();
  };

  const filteredAssets = watchedMarkets.length > 0
    ? assets.filter((a) => watchedMarkets.includes(a.market_type))
    : assets;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">New Strategy</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Strategy Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Crypto Momentum"
            className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Signal Type</label>
          <div className="grid grid-cols-2 gap-2">
            {TYPE_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType(t.id)}
                className={`rounded-lg border py-2.5 text-sm font-medium transition ${
                  type === t.id
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Watched Markets</label>
          <div className="grid grid-cols-3 gap-2">
            {MARKET_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => toggleMarket(m)}
                className={`rounded-lg border py-2 text-sm font-medium capitalize transition ${
                  watchedMarkets.includes(m)
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-1.5">Leave empty to watch all markets.</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-2">Specific Assets (optional)</label>
          <div className="max-h-32 overflow-y-auto grid grid-cols-2 gap-1.5">
            {filteredAssets.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => toggleAsset(a.id)}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                  selectedAssetIds.includes(a.id)
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {selectedAssetIds.includes(a.id) && <Check className="w-3 h-3" />}
                {a.symbol}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Risk per Trade (%)</label>
            <input
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={riskPct}
              onChange={(e) => setRiskPct(e.target.value)}
              className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Trailing Stop (%) <span className="text-slate-600">(optional)</span>
            </label>
            <input
              type="number"
              min="0.1"
              max="20"
              step="0.1"
              value={trailingStopPct}
              onChange={(e) => setTrailingStopPct(e.target.value)}
              placeholder="Leave empty to disable"
              className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
            />
            <p className="text-xs text-slate-500 mt-1.5">
              When set, the stop-loss automatically follows price in your favor as a position gains,
              locking in more profit — it only ever tightens, never loosens.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Min Confidence (%)</label>
            <input
              type="number"
              min="1"
              max="100"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
              className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Execution Mode</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAutoTrade(false)}
              className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition ${
                !autoTrade
                  ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                  : 'border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <Hand className="w-4 h-4" />
              Manual Approval
            </button>
            <button
              type="button"
              onClick={() => setAutoTrade(true)}
              className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition ${
                autoTrade
                  ? 'border-sky-500 bg-sky-500/10 text-sky-400'
                  : 'border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="w-4 h-4" />
              Auto-Trade
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1.5">
            {autoTrade
              ? 'Trades open automatically when signals exceed the confidence threshold.'
              : 'Signals become suggestions you approve from the Signals page.'}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Execution Target</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setExecutionTarget('paper')}
              className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition ${
                executionTarget === 'paper'
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                  : 'border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <FlaskConical className="w-4 h-4" />
              Paper (Simulated)
            </button>
            <button
              type="button"
              onClick={() => setExecutionTarget('testnet_live')}
              className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition ${
                executionTarget === 'testnet_live'
                  ? 'border-violet-500 bg-violet-500/10 text-violet-400'
                  : 'border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <Globe className="w-4 h-4" />
              Binance Testnet
            </button>
            <button
              type="button"
              onClick={() => setExecutionTarget('coindcx_live')}
              className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition ${
                executionTarget === 'coindcx_live'
                  ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                  : 'border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <Coins className="w-4 h-4" />
              CoinDCX (Live)
            </button>
            <button
              type="button"
              onClick={() => setExecutionTarget('fivepaisa_live')}
              className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition ${
                executionTarget === 'fivepaisa_live'
                  ? 'border-rose-500 bg-rose-500/10 text-rose-400'
                  : 'border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <Landmark className="w-4 h-4" />
              5paisa (Live)
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1.5">
            {executionTarget === 'testnet_live'
              ? 'Crypto trades execute on Binance Testnet (real exchange API, fake money). Non-crypto assets stay in paper mode.'
              : executionTarget === 'coindcx_live'
              ? 'Crypto trades execute on CoinDCX with REAL money using your saved CoinDCX keys (Settings page). Non-crypto assets stay in paper mode.'
              : executionTarget === 'fivepaisa_live'
              ? 'Stock trades execute on 5paisa with REAL money using your saved 5paisa keys (Settings page). Non-stock assets stay in paper mode.'
              : 'Trades are simulated internally — no external exchange calls.'}
          </p>
          {(executionTarget === 'coindcx_live' || executionTarget === 'fivepaisa_live') && (
            <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mt-2">
              This mode trades with real money. Make sure you've added your {executionTarget === 'coindcx_live' ? 'CoinDCX' : '5paisa'} API keys in Settings and start with a small risk-per-trade.
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2.5">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white border border-slate-700 transition"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create Strategy'}
          </button>
        </div>
      </div>
    </div>
  );
}
