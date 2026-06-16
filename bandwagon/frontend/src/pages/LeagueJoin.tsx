import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Users, ChevronLeft, Music2 } from 'lucide-react';
import { api } from '../api/client';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';

interface LeaguePreview {
  id: string;
  name: string;
  commissionerName: string;
  memberCount: number;
  teamCount: number;
  status: string;
}

export function LeagueJoin() {
  const { code } = useParams<{ code?: string }>();
  const navigate = useNavigate();
  const [manualCode, setManualCode] = useState('');
  const [preview, setPreview] = useState<LeaguePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (code) loadPreview(code);
  }, [code]);

  async function loadPreview(c: string) {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<LeaguePreview>(`/leagues/invite/${c}`);
      setPreview(data);
    } catch {
      setError('Invalid or expired invite link');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    const c = code || manualCode.trim().toUpperCase();
    if (!c) return;
    setJoining(true);
    setError('');
    try {
      const { league } = await api.post<{ league: { id: string } }>(`/leagues/join/${c}`, {});
      navigate(`/leagues/${league.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join league');
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/30 via-gray-950 to-purple-950/20 pointer-events-none" />
      <header className="relative border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/home" className="text-gray-400 hover:text-white transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Music2 className="w-5 h-5 text-indigo-400" />
            <span className="font-bold text-white">Join a League</span>
          </div>
        </div>
      </header>

      <main className="relative max-w-md mx-auto px-4 py-8">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
        ) : preview ? (
          <Card className="p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center mx-auto mb-4">
              <Users className="w-7 h-7 text-indigo-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-1">{preview.name}</h2>
            <p className="text-gray-400 text-sm mb-4">
              Commissioner: {preview.commissionerName} · {preview.memberCount}/{preview.teamCount} teams joined
            </p>
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400 mb-4">
                {error}
              </div>
            )}
            <Button onClick={handleJoin} disabled={joining} className="w-full" size="lg">
              {joining ? 'Joining…' : 'Join League'}
            </Button>
          </Card>
        ) : (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Enter an Invite Code</h2>
            <div className="space-y-4">
              <Input
                label="Invite Code"
                placeholder="e.g. ABC12345"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              />
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}
              <Button onClick={() => loadPreview(manualCode)} disabled={!manualCode.trim() || loading} className="w-full">
                Look Up League
              </Button>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
