import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Users, Trophy, Music2, ChevronRight, Clock, X } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { Avatar } from '../components/ui/Avatar';
import type { LeagueCard, Notification } from '../api/types';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: 'Pre-Season', cls: 'bg-yellow-500/20 text-yellow-300' },
    drafting: { label: 'Draft Live', cls: 'bg-green-500/20 text-green-300 animate-pulse' },
    active: { label: 'Week Active', cls: 'bg-indigo-500/20 text-indigo-300' },
    complete: { label: 'Complete', cls: 'bg-gray-500/20 text-gray-400' },
  };
  const s = map[status] || map.pending;
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export function Home() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: leagues, isLoading } = useQuery({
    queryKey: ['leagues'],
    queryFn: () => api.get<LeagueCard[]>('/leagues'),
  });

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<Notification[]>('/notifications'),
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/dismiss`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/30 via-gray-950 to-purple-950/20 pointer-events-none" />

      {/* Nav */}
      <header className="relative border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/home" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <Music2 className="w-4 h-4 text-indigo-400" />
            </div>
            <span className="font-bold text-white text-lg">Bandwagon</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/account" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Avatar src={user?.avatarUrl} name={user?.username ?? '?'} size="sm" />
              <span className="text-gray-400 text-sm">{user?.username}</span>
            </Link>
            <Button variant="ghost" size="sm" onClick={logout}>Sign out</Button>
          </div>
        </div>
      </header>

      {notifications && notifications.length > 0 && (
        <div className="relative max-w-5xl mx-auto px-4 pt-4 space-y-2">
          {notifications.map((n) => (
            <div key={n.id} className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-300">
              <span className="flex-1">{n.message}</span>
              <button
                onClick={() => dismissMutation.mutate(n.id)}
                className="shrink-0 text-red-400 hover:text-red-200 transition-colors mt-0.5"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <main className="relative max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Your Leagues</h1>
            <p className="text-gray-400 text-sm mt-0.5">Manage your fantasy music rosters</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate('/leagues/join')}>
              <Users className="w-4 h-4" />
              Join
            </Button>
            <Button size="sm" onClick={() => navigate('/leagues/create')}>
              <Plus className="w-4 h-4" />
              Create
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Spinner className="w-8 h-8" />
          </div>
        ) : leagues && leagues.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {leagues.map((league) => (
              <Link key={league.id} to={`/leagues/${league.id}`}>
                <Card className="p-5 hover:bg-white/10 transition-colors cursor-pointer group">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="font-semibold text-white">{league.name}</h2>
                        <StatusBadge status={league.status} />
                      </div>
                      <p className="text-sm text-gray-400">
                        {league.myTeam.name} · {league.memberCount}/{league.teamCount} teams
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-gray-400 transition-colors" />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="text-center">
                        <div className="text-xl font-bold text-white">{league.myTeam.wins}</div>
                        <div className="text-xs text-gray-500">W</div>
                      </div>
                      <div className="text-gray-600">-</div>
                      <div className="text-center">
                        <div className="text-xl font-bold text-white">{league.myTeam.losses}</div>
                        <div className="text-xs text-gray-500">L</div>
                      </div>
                    </div>

                    {league.status === 'active' && league.opponent && (
                      <div className="text-right">
                        <div className="text-xs text-gray-500 mb-1 flex items-center justify-end gap-1">
                          <Clock className="w-3 h-3" />
                          Week {league.currentWeek}
                        </div>
                        <div className="text-sm font-semibold text-white">
                          <span className={league.myScore >= league.opponentScore ? 'text-green-400' : 'text-red-400'}>
                            {league.myScore.toFixed(1)}
                          </span>
                          <span className="text-gray-600 mx-1">vs</span>
                          {league.opponentScore.toFixed(1)}
                        </div>
                        <div className="text-xs text-gray-500">{league.opponent.name}</div>
                      </div>
                    )}

                    {league.status === 'drafting' && (
                      <Link to={`/leagues/${league.id}/draft`} onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" className="animate-pulse">
                          Draft Live →
                        </Button>
                      </Link>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
              <Trophy className="w-8 h-8 text-indigo-400" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">No leagues yet</h2>
            <p className="text-gray-400 mb-6 max-w-xs mx-auto">
              Draft a team of artists and compete with friends based on real streaming data
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => navigate('/leagues/create')}>
                <Plus className="w-4 h-4" />
                Create a League
              </Button>
              <Button variant="secondary" onClick={() => navigate('/leagues/join')}>
                <Users className="w-4 h-4" />
                Join a League
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
