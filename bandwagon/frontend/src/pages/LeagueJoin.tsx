import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Users, ChevronLeft, Music2 } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface LeaguePreview {
  id: string;
  name: string;
  commissionerName: string;
  memberCount: number;
  teamCount: number;
  status: string;
}

interface PublicLeague {
  id: string;
  name: string;
  commissionerName: string;
  memberCount: number;
  teamCount: number;
  draftTime: string | null;
  inviteCode: string;
}

export function LeagueJoin() {
  const { code } = useParams<{ code?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [manualCode, setManualCode] = useState('');
  const [resolvedCode, setResolvedCode] = useState('');
  const [preview, setPreview] = useState<LeaguePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [publicLeagues, setPublicLeagues] = useState<PublicLeague[]>([]);

  // Post-join customize step
  const [joinedLeagueId, setJoinedLeagueId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (code) loadPreview(code);
    api.get<PublicLeague[]>('/leagues/public').then(setPublicLeagues).catch(() => {});
  }, [code]);

  async function loadPreview(c: string) {
    setLoading(true);
    setError('');
    setResolvedCode(c);
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
    const c = code || resolvedCode || manualCode.trim().toUpperCase();
    if (!c) return;
    setJoining(true);
    setError('');
    try {
      const { league } = await api.post<{ league: { id: string } }>(`/leagues/join/${c}`, {});
      setTeamName(user?.username ? `${user.username}'s Squad` : '');
      setJoinedLeagueId(league.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join league');
    } finally {
      setJoining(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError('Only JPEG, PNG, or WebP images are allowed');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError('Image must be smaller than 5MB');
      return;
    }
    setFileError('');
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  async function handleSaveAndContinue() {
    if (!joinedLeagueId) return;
    setSaving(true);
    try {
      const formData = new FormData();
      if (teamName.trim()) formData.append('name', teamName.trim());
      if (logoFile) formData.append('logo', logoFile);
      await api.put(`/leagues/${joinedLeagueId}/team`, formData);
    } catch {
      // Non-fatal — just navigate anyway
    } finally {
      navigate(`/leagues/${joinedLeagueId}`);
    }
  }

  if (joinedLeagueId) {
    return (
      <div className="min-h-screen bg-gray-950">
        <header className="relative border-b border-white/10">
          <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Music2 className="w-5 h-5 text-indigo-400" />
              <span className="font-bold text-white">Set Up Your Team</span>
            </div>
          </div>
        </header>
        <main className="relative max-w-md mx-auto px-4 py-8">
          <Card className="p-6">
            <p className="text-gray-400 text-sm mb-5">You joined <span className="text-white font-medium">{preview?.name}</span>. Give your team a name and logo before you head in.</p>
            <div className="flex items-center gap-3 mb-5">
              <div className="relative shrink-0">
                <Avatar src={logoPreview} name={teamName || '?'} size="xl" />
                <label className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-indigo-500 border-2 border-gray-950 flex items-center justify-center cursor-pointer hover:bg-indigo-400 transition-colors">
                  <span className="text-white text-xs leading-none">+</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} className="hidden" />
                </label>
              </div>
              <div className="flex-1">
                <Input
                  label="Team Name"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  maxLength={30}
                />
                {fileError && <p className="text-xs text-red-400 mt-1">{fileError}</p>}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={handleSaveAndContinue} disabled={saving} className="w-full" size="lg">
                {saving ? 'Saving…' : 'Save & Enter League'}
              </Button>
              <button
                onClick={() => navigate(`/leagues/${joinedLeagueId}`)}
                className="text-sm text-gray-500 hover:text-gray-300 transition-colors py-1"
              >
                Skip for now
              </button>
            </div>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
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
          <div className="space-y-6">
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

            {publicLeagues.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">Open Public Leagues</h2>
                <div className="space-y-2">
                  {publicLeagues.map((league) => (
                    <Card key={league.id} className="p-4 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-white font-medium truncate">{league.name}</p>
                        <p className="text-sm text-gray-400">
                          by {league.commissionerName} · {league.memberCount}/{league.teamCount} teams
                          {league.draftTime && (
                            <> · Draft {new Date(league.draftTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>
                          )}
                        </p>
                      </div>
                      <Button size="sm" onClick={() => loadPreview(league.inviteCode)} className="shrink-0">
                        Join
                      </Button>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
