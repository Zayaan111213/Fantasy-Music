import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Music2, ChevronLeft, Copy, Check } from 'lucide-react';
import { api } from '../api/client';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';

type Step = 'form' | 'success';

export function LeagueCreate() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [teamCount, setTeamCount] = useState(8);
  const [privacy, setPrivacy] = useState<'private' | 'public'>('private');
  const [draftTime, setDraftTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const league = await api.post<{ id: string; inviteCode: string }>('/leagues', {
        name,
        teamCount,
        privacy,
        draftTime: draftTime || undefined,
      });
      setInviteCode(league.inviteCode);
      setLeagueId(league.id);
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create league');
    } finally {
      setLoading(false);
    }
  }

  const inviteUrl = `${window.location.origin}/leagues/join/${inviteCode}`;

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/30 via-gray-950 to-purple-950/20 pointer-events-none" />
        <div className="relative w-full max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-green-500/20 border border-green-500/30 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">League Created!</h1>
          <p className="text-gray-400 mb-6">Share this link to invite your friends</p>

          <Card className="p-4 mb-4">
            <div className="flex items-center gap-2 bg-white/5 rounded-lg p-3">
              <span className="flex-1 text-sm text-gray-300 truncate">{inviteUrl}</span>
              <button onClick={copyInvite} className="shrink-0 text-indigo-400 hover:text-indigo-300 transition-colors">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </Card>

          <Button onClick={() => navigate(`/leagues/${leagueId}`)} className="w-full" size="lg">
            Go to League
          </Button>
        </div>
      </div>
    );
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
            <span className="font-bold text-white">Create a League</span>
          </div>
        </div>
      </header>

      <main className="relative max-w-2xl mx-auto px-4 py-8">
        <Card className="p-6">
          <form onSubmit={handleCreate} className="space-y-5">
            <Input
              label="League Name"
              placeholder="e.g. Chart Toppers 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-300">Number of Teams</label>
              <div className="flex gap-2 flex-wrap">
                {[4, 6, 8, 10, 12].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setTeamCount(n)}
                    className={`w-12 h-10 rounded-lg text-sm font-medium transition-colors ${teamCount === n ? 'bg-indigo-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-300">Privacy</label>
              <div className="flex gap-2">
                {(['private', 'public'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPrivacy(p)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${privacy === p ? 'bg-indigo-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                  >
                    {p === 'private' ? '🔒 Private' : '🌐 Public'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500">
                {privacy === 'private' ? 'Join by invite link only' : 'Anyone can join until full'}
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-300">Draft Date & Time (optional)</label>
              <input
                type="datetime-local"
                value={draftTime}
                onChange={(e) => setDraftTime(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full" size="lg">
              {loading ? 'Creating…' : 'Create League & Get Invite Link'}
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}
