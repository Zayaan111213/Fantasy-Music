import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { FullPageSpinner } from './components/ui/Spinner';
import { Landing } from './pages/Landing';
import { Auth } from './pages/Auth';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Onboarding } from './pages/Onboarding';
import { AccountSettings } from './pages/AccountSettings';
import { Home } from './pages/Home';
import { Charts } from './pages/Charts';
import { LeagueCreate } from './pages/LeagueCreate';
import { LeagueJoin } from './pages/LeagueJoin';
import { LeagueHub } from './pages/LeagueHub';
import { DraftRoom } from './pages/DraftRoom';
import { TradePropose } from './pages/TradePropose';
import { ArtistDetail } from './pages/ArtistDetail';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

function RequireOnboarded({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user!.username === null) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <RequireOnboarded>{children}</RequireOnboarded>
    </RequireAuth>
  );
}

function LandingOrHome() {
  const { user } = useAuth();
  if (user) return <Navigate to="/home" replace />;
  return <Landing />;
}

export function App() {
  const { isLoading } = useAuth();
  if (isLoading) return <FullPageSpinner />;

  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
      <Route path="/" element={<LandingOrHome />} />
      <Route path="/home" element={<ProtectedRoute><Home /></ProtectedRoute>} />
      <Route path="/charts" element={<ProtectedRoute><Charts /></ProtectedRoute>} />
      <Route path="/account" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
      <Route path="/leagues/create" element={<ProtectedRoute><LeagueCreate /></ProtectedRoute>} />
      <Route path="/leagues/join" element={<ProtectedRoute><LeagueJoin /></ProtectedRoute>} />
      <Route path="/leagues/join/:code" element={<ProtectedRoute><LeagueJoin /></ProtectedRoute>} />
      <Route path="/leagues/:id" element={<ProtectedRoute><LeagueHub /></ProtectedRoute>} />
      <Route path="/leagues/:id/draft" element={<ProtectedRoute><DraftRoom /></ProtectedRoute>} />
      <Route path="/leagues/:id/trade" element={<ProtectedRoute><TradePropose /></ProtectedRoute>} />
      <Route path="/artists/:id" element={<ProtectedRoute><ArtistDetail /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
