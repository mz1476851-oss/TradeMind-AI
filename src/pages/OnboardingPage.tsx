import { useState, type FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import type { MarketType, RiskTolerance } from '@/lib/types';
import { TrendingUp, ArrowRight, Check } from 'lucide-react';

const MARKETS: { id: MarketType; label: string; desc: string }[] = [
  { id: 'stocks', label: 'Stocks', desc: 'Equities & ETFs' },
  { id: 'crypto', label: 'Crypto', desc: 'Digital assets' },
  { id: 'forex', label: 'Forex', desc: 'Currency pairs' },
];

const RISKS: { id: RiskTolerance; label: string; desc: string }[] = [
  { id: 'low', label: 'Low', desc: 'Capital preservation' },
  { id: 'medium', label: 'Medium', desc: 'Balanced growth' },
  { id: 'high', label: 'High', desc: 'Aggressive returns' },
];

export function OnboardingPage() {
  const { user, refreshProfile, signOut } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [capital, setCapital] = useState('10000');
  const [risk, setRisk] = useState<RiskTolerance>('medium');
  const [markets, setMarkets] = useState<MarketType[]>(['stocks']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleMarket = (m: MarketType) => {
    setMarkets((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (markets.length === 0) {
      setError('Select at least one market.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: dbError } = await supabase.from('users_profile').upsert({
      user_id: user!.id,
      display_name: displayName.trim() || 'Trader',
      virtual_capital: parseFloat(capital) || 10000,
      starting_capital: parseFloat(capital) || 10000,
      risk_tolerance: risk,
      preferred_markets: markets,
    });
    setBusy(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    await refreshProfile();
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center mb-3">
            <TrendingUp className="w-6 h-6 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-xl font-bold text-white">Welcome to TradeMind AI</h1>
          <p className="text-sm text-slate-400 mt-1">Let's set up your trading profile</p>
        </div>

        <form onSubmit={submit} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alex Trader"
              className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Starting Virtual Capital
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
              <input
                type="number"
                min="100"
                step="100"
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
                className="w-full bg-slate-800/60 border border-slate-700 rounded-lg pl-7 pr-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
              />
            </div>
            <p className="text-xs text-slate-500 mt-1.5">Default: $10,000 — this is simulated money.</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Risk Tolerance</label>
            <div className="grid grid-cols-3 gap-2">
              {RISKS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRisk(r.id)}
                  className={`rounded-xl border p-3 text-left transition ${
                    risk === r.id
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-slate-700 bg-slate-800/40 hover:border-slate-600'
                  }`}
                >
                  <span className="block text-sm font-semibold text-white">{r.label}</span>
                  <span className="block text-xs text-slate-400 mt-0.5">{r.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Preferred Markets</label>
            <div className="grid grid-cols-3 gap-2">
              {MARKETS.map((m) => {
                const active = markets.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMarket(m.id)}
                    className={`relative rounded-xl border p-3 text-left transition ${
                      active
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'border-slate-700 bg-slate-800/40 hover:border-slate-600'
                    }`}
                  >
                    {active && (
                      <Check className="absolute top-2 right-2 w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span className="block text-sm font-semibold text-white">{m.label}</span>
                    <span className="block text-xs text-slate-400 mt-0.5">{m.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2.5">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={signOut}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-semibold py-2.5 rounded-lg transition shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Start Trading'}
              {!busy && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
