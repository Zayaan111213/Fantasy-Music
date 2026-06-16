import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { FullPageSpinner } from './components/ui/Spinner';
import { Auth } from './pages/Auth';
import { Home } from './pages/Home';
import { LeagueCreate } from './pages/LeagueCreate';
import { LeagueJoin } from './pages/LeagueJoin';
import { LeagueHub } from './pages/LeagueHub';
import { DraftRoom } from './pages/DraftRoom';
import { ArtistDetail } from './pages/ArtistDetail';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

export function App() {
  const { isLoading } = useAuth();
  if (isLoading) return <FullPageSpinner />;

  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/home" element={<RequireAuth><Home /></RequireAuth>} />
      <Route path="/leagues/create" element={<RequireAuth><LeagueCreate /></RequireAuth>} />
      <Route path="/leagues/join" element={<RequireAuth><LeagueJoin /></RequireAuth>} />
      <Route path="/leagues/join/:code" element={<RequireAuth><LeagueJoin /></RequireAuth>} />
      <Route path="/leagues/:id" element={<RequireAuth><LeagueHub /></RequireAuth>} />
      <Route path="/leagues/:id/draft" element={<RequireAuth><DraftRoom /></RequireAuth>} />
      <Route path="/artists/:id" element={<RequireAuth><ArtistDetail /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
