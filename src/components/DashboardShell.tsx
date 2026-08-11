import { useState, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { NotificationBell } from '@/components/NotificationBell';
import {
  LayoutDashboard,
  Radio,
  History,
  Settings2,
  Briefcase,
  Cog,
  LogOut,
  TrendingUp,
  Menu,
  X,
  ShieldCheck,
  BarChart3,
} from 'lucide-react';

export type PageId =
  | 'dashboard'
  | 'signals'
  | 'history'
  | 'strategies'
  | 'portfolio'
  | 'settings'
  | 'admin'
  | 'backtest';

interface NavItem {
  id: PageId;
  label: string;
  icon: typeof LayoutDashboard;
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'signals', label: 'Signals', icon: Radio },
  { id: 'history', label: 'Trade History', icon: History },
  { id: 'strategies', label: 'Strategies', icon: Settings2 },
  { id: 'backtest', label: 'Backtest', icon: BarChart3 },
  { id: 'portfolio', label: 'Portfolio', icon: Briefcase },
  { id: 'settings', label: 'Settings', icon: Cog },
  { id: 'admin', label: 'Admin', icon: ShieldCheck },
];

export function DashboardShell({
  current,
  onNavigate,
  children,
}: {
  current: PageId;
  onNavigate: (id: PageId) => void;
  children: ReactNode;
}) {
  const { profile, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const initials = (profile?.display_name || 'T')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const navClick = (id: PageId) => {
    onNavigate(id);
    setMobileOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex w-60 flex-col border-r border-slate-800 bg-slate-900/40 shrink-0">
        <SidebarContent current={current} onNavigate={navClick} />
      </aside>

      {/* Sidebar — mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-60 flex flex-col border-r border-slate-800 bg-slate-900">
            <SidebarContent current={current} onNavigate={navClick} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
          <div className="flex items-center justify-between px-4 md:px-6 h-16">
            <div className="flex items-center gap-3">
              <button
                className="md:hidden p-1.5 rounded-lg hover:bg-slate-800 transition"
                onClick={() => setMobileOpen(true)}
              >
                <Menu className="w-5 h-5 text-slate-300" />
              </button>
              <div className="flex items-center gap-2 md:hidden">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-white" strokeWidth={2.5} />
                </div>
                <span className="font-bold text-white text-sm">TradeMind AI</span>
              </div>
              <span className="hidden md:block text-sm text-slate-400">
                {NAV.find((n) => n.id === current)?.label}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                PAPER TRADING MODE
              </span>
              <NotificationBell />
              <div className="flex items-center gap-2 pl-3 border-l border-slate-800">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center text-xs font-semibold text-white">
                  {initials}
                </div>
                <button
                  onClick={signOut}
                  className="p-1.5 rounded-lg hover:bg-slate-800 transition text-slate-400 hover:text-white"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 md:p-6 overflow-auto">{children}</main>

        {/* Disclaimer footer */}
        <footer className="border-t border-slate-800 px-4 md:px-6 py-3 bg-slate-950/80">
          <p className="text-center text-xs text-slate-500">
            TradeMind AI is a paper trading simulator for educational purposes only. This is not financial advice.
          </p>
        </footer>
      </div>
    </div>
  );
}

function SidebarContent({
  current,
  onNavigate,
}: {
  current: PageId;
  onNavigate: (id: PageId) => void;
}) {
  return (
    <>
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-slate-800">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
          <TrendingUp className="w-4.5 h-4.5 text-white" strokeWidth={2.5} />
        </div>
        <span className="font-bold text-white tracking-tight">TradeMind AI</span>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {NAV.map((item) => {
          const active = current === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                active
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60 border border-transparent'
              }`}
            >
              <Icon className="w-4.5 h-4.5 shrink-0" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-800">
        <div className="rounded-xl bg-slate-800/40 p-3 text-center">
          <p className="text-xs text-slate-500">Simulation Only</p>
          <p className="text-xs text-slate-400 mt-0.5">No real funds at risk</p>
        </div>
      </div>
    </>
  );
}
