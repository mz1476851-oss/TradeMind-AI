import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { ShieldCheck, Save, RefreshCw } from 'lucide-react';

interface AdminAsset {
  id: string;
  symbol: string;
  market_type: string;
  name: string;
  fivepaisa_scrip_code: number | null;
}

export function AdminAssetsPage() {
  const [assets, setAssets] = useState<AdminAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke('admin-manage-assets', {
      body: { action: 'list' },
    });
    setLoading(false);

    if (fnError) {
      setError(fnError.message);
      setAuthorized(false);
      return;
    }
    if (!data?.success) {
      setError(data?.error ?? 'Failed to load assets');
      setAuthorized(data?.error === 'Not authorized' ? false : null);
      return;
    }
    setAuthorized(true);
    const list = (data.assets ?? []) as AdminAsset[];
    setAssets(list);
    const initialDrafts: Record<string, string> = {};
    for (const a of list) {
      initialDrafts[a.id] = a.fivepaisa_scrip_code != null ? String(a.fivepaisa_scrip_code) : '';
    }
    setDrafts(initialDrafts);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveScripCode = async (assetId: string) => {
    const raw = drafts[assetId]?.trim() ?? '';
    const value = raw === '' ? null : parseInt(raw, 10);
    if (raw !== '' && (value === null || Number.isNaN(value))) {
      setError('ScripCode must be a number');
      return;
    }
    setSavingId(assetId);
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke('admin-manage-assets', {
      body: { action: 'update_scrip_code', asset_id: assetId, fivepaisa_scrip_code: value },
    });
    setSavingId(null);
    if (fnError || !data?.success) {
      setError(fnError?.message ?? data?.error ?? 'Failed to save');
      return;
    }
    setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, fivepaisa_scrip_code: value } : a)));
    setSavedId(assetId);
    setTimeout(() => setSavedId(null), 1500);
  };

  if (loading) {
    return <div className="text-sm text-slate-500 p-6">Loading…</div>;
  }

  if (authorized === false) {
    return (
      <div className="p-6">
        <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-3 max-w-lg">
          {error ?? 'Not authorized to view this page.'}
        </p>
      </div>
    );
  }

  const stockAssets = assets.filter((a) => a.market_type === 'stocks');
  const otherAssets = assets.filter((a) => a.market_type !== 'stocks');

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <h1 className="text-lg font-semibold text-white">Admin: Asset Mappings</h1>
        </div>
        <button
          onClick={load}
          className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>
      <p className="text-xs text-slate-500 -mt-4">
        5paisa identifies stocks by a numeric ScripCode, not by symbol. Map each stock asset to its
        ScripCode here so live 5paisa orders can be placed for it. Assets without a mapping stay in
        paper mode automatically.
      </p>

      {error && (
        <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2.5">
          {error}
        </p>
      )}

      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 text-xs font-medium text-slate-400 uppercase">
          Stocks ({stockAssets.length})
        </div>
        <div className="divide-y divide-slate-800">
          {stockAssets.length === 0 && (
            <p className="text-sm text-slate-500 px-4 py-4">No stock assets found.</p>
          )}
          {stockAssets.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">{a.symbol}</p>
                <p className="text-xs text-slate-500 truncate">{a.name}</p>
              </div>
              <input
                type="text"
                inputMode="numeric"
                value={drafts[a.id] ?? ''}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))}
                placeholder="ScripCode"
                className="w-28 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
              />
              <button
                onClick={() => saveScripCode(a.id)}
                disabled={savingId === a.id}
                className="text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg transition disabled:opacity-50 inline-flex items-center gap-1"
              >
                <Save className="w-3 h-3" />
                {savingId === a.id ? 'Saving…' : savedId === a.id ? 'Saved' : 'Save'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {otherAssets.length > 0 && (
        <p className="text-xs text-slate-600">
          {otherAssets.length} non-stock asset(s) (crypto/forex) don't need a ScripCode — they use
          Binance testnet / CoinDCX instead.
        </p>
      )}
    </div>
  );
}
