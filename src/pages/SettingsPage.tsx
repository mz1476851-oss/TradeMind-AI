import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { RiskTolerance } from '@/lib/types';
import { Cog, Save, RotateCcw, AlertTriangle, X, Check, User, Shield, Calendar } from 'lucide-react';

const RISKS: { id: RiskTolerance; label: string; desc: string }[] = [
  { id: 'low', label: 'Low', desc: 'Capital preservation' },
  { id: 'medium', label: 'Medium', desc: 'Balanced growth' },
  { id: 'high', label: 'High', desc: 'Aggressive returns' },
];

export function SettingsPage() {
  const { user, profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [risk, setRisk] = useState<RiskTolerance>(profile?.risk_tolerance ?? 'medium');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReset, setShowReset] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.display_name ?? '');
    setRisk(profile?.risk_tolerance ?? 'medium');
  }, [profile]);

  const saveProfile = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error: dbError } = await supabase
      .from('users_profile')
      .update({
        display_name: displayName.trim() || 'Trader',
        risk_tolerance: risk,
      })
      .eq('user_id', user!.id);
    setSaving(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    setSaved(true);
    await refreshProfile();
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-400 mt-1">Manage your profile and simulation preferences.</p>
      </div>

      {/* Profile section */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">Profile</h2>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Alex Trader"
            className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-2">Risk Tolerance</label>
          <div className="grid grid-cols-3 gap-2">
            {RISKS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRisk(r.id)}
                className={`rounded-lg border p-3 text-left transition ${
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

        {error && (
          <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2.5">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={saveProfile}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-semibold text-sm transition shadow-lg shadow-emerald-500/20 disabled:opacity-50"
          >
            {saving ? <RotateCcw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-400">
              <Check className="w-4 h-4" />
              Saved
            </span>
          )}
        </div>
      </div>

      {/* Account info section */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-white">Account Information</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-slate-800/40 rounded-lg px-4 py-3">
            <p className="text-xs text-slate-500 mb-1">Starting Virtual Capital</p>
            <p className="text-base font-semibold text-white">
              ${(profile?.starting_capital ?? 10000).toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-slate-800/40 rounded-lg px-4 py-3">
            <p className="text-xs text-slate-500 mb-1 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Account Created
            </p>
            <p className="text-base font-semibold text-white">
              {profile?.created_at
                ? new Date(profile.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400" />
          <h2 className="text-sm font-semibold text-rose-400">Danger Zone</h2>
        </div>
        <p className="text-sm text-slate-400">
          Reset your simulation back to its starting state. This closes all open trades,
          clears your trade history, resets your virtual capital to the starting amount,
          and deletes all portfolio snapshots. This cannot be undone.
        </p>
        <button
          onClick={() => setShowReset(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 font-semibold text-sm hover:bg-rose-500/20 transition"
        >
          <RotateCcw className="w-4 h-4" />
          Reset Simulation
        </button>
      </div>

      {showReset && (
        <ResetConfirmation
          startingCapital={profile?.starting_capital ?? 10000}
          onClose={() => setShowReset(false)}
          onDone={() => {
            setShowReset(false);
            refreshProfile();
          }}
        />
      )}
    </div>
  );
}

function ResetConfirmation({
  startingCapital,
  onClose,
  onDone,
}: {
  startingCapital: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      // Close all open trades
      await supabase
        .from('trades')
        .update({ status: 'cancelled', closed_at: new Date().toISOString() })
        .eq('user_id', user!.id)
        .eq('status', 'open');

      // Delete all trades
      await supabase.from('trades').delete().eq('user_id', user!.id);

      // Delete all portfolio snapshots
      await supabase.from('portfolio_snapshots').delete().eq('user_id', user!.id);

      // Reset virtual capital
      await supabase
        .from('users_profile')
        .update({ virtual_capital: startingCapital })
        .eq('user_id', user!.id);

      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-slate-900 border border-rose-500/30 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-400" />
            <h2 className="text-lg font-bold text-white">Reset Simulation?</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-slate-400">
          This will permanently:
        </p>
        <ul className="text-sm text-slate-400 space-y-1.5 ml-4">
          <li className="list-disc">Close all open trades</li>
          <li className="list-disc">Delete your entire trade history</li>
          <li className="list-disc">Clear all portfolio snapshots</li>
          <li className="list-disc">Reset virtual capital to ${startingCapital.toLocaleString('en-US')}</li>
        </ul>

        {error && (
          <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2.5">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white border border-slate-700 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={reset}
            disabled={busy}
            className="flex-1 bg-rose-500/20 border border-rose-500/40 text-rose-400 hover:bg-rose-500/30 font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
          >
            {busy ? 'Resetting…' : 'Yes, Reset Everything'}
          </button>
        </div>
      </div>
    </div>
  );
}
