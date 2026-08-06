import { useState } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AuthPage } from '@/pages/AuthPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { DashboardShell, type PageId } from '@/components/DashboardShell';
import { renderPage } from '@/pages/Pages';

function AppInner() {
  const { session, profile, loading } = useAuth();
  const [page, setPage] = useState<PageId>('dashboard');

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 animate-pulse" />
          <p className="text-sm text-slate-500">Loading…</p>
        </div>
      </div>
    );
  }

  if (!session) return <AuthPage />;
  if (!profile) return <OnboardingPage />;

  return (
    <DashboardShell current={page} onNavigate={setPage}>
      {renderPage(page)}
    </DashboardShell>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

export default App;
