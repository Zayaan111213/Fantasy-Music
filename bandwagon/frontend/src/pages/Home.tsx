import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Users, Trophy, ChevronRight, Clock, X, HelpCircle, Music, Disc3 } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { Avatar } from '../components/ui/Avatar';
import { HowItWorksModal } from '../components/HowItWorksModal';
import type { ChartRow, GlobalActivityItem, LeagueCard, MoversPayload, Notification } from '../api/types';
import { WagonMark, Wordmark } from '../components/Logo';
import { timeAgo } from '../utils/timeAgo';

function MoverRow({ row }: { row: ChartRow }) {
  const up = (row.delta ?? 0) > 0;
  const a = row.artists[0];
  const inner = (
    <>
      <div className="w-6 font-serif text-base text-gray-500 text-center shrink-0">{row.rank}</div>
      {a ? (
        <Avatar src={a.imageUrl} name={a.name} size="sm" />
      ) : (
        <div className="w-8 h-8 shrink-0 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-500 text-xs">♪</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white truncate">{row.title}</div>
        <div className="text-xs text-gray-400 truncate">{row.artists.map((x) => x.name).join(', ') || '—'}</div>
      </div>
      <div className={`text-[13px] font-bold shrink-0 ${up ? 'text-green-400' : 'text-red-400'}`}>
        {up ? '▲' : '▼'} {Math.abs(row.delta ?? 0)}
      </div>
    </>
  );
  const cls = 'flex items-center gap-3 py-2 border-b border-gray-900 last:border-0';
  return a ? (
    <Link to={`/artists/${a.id}`} className={`${cls} hover:bg-white/5 -mx-2 px-2 rounded-lg transition-colors`}>{inner}</Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function MoversCard({ label, icon: Icon, tab, data }: {
  label: string;
  icon: typeof Music;
  tab: 'songs' | 'albums';
  data?: { risers: ChartRow[]; fallers: ChartRow[] };
}) {
  const rows = [...(data?.risers.slice(0, 3) ?? []), ...(data?.fallers.slice(0, 2) ?? [])];
  return (
    <Card className="p-5">
      <h3 className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">
          <Icon className="w-4 h-4" />
          {label} · This Week's Movers
        </span>
        <Link to={`/charts?tab=${tab}`} className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors">
          Full chart →
        </Link>
      </h3>
      {rows.length > 0 ? (
        rows.map((row) => <MoverRow key={row.rank} row={row} />)
      ) : (
        <p className="text-sm text-gray-500 py-4 text-center">No chart movement yet this week.</p>
      )}
    </Card>
  );
}

// The raw feed messages are full sentences with artist lists and details —
// on Home each item is compressed to one short line: fixed phrasing for the
// verbose types, otherwise the first clause of the message, truncated.
const FIXED_SUMMARIES: Record<string, string> = {
  lineup_reminder: 'Set your lineup before Tuesday',
  waiver_result: 'Your waiver claim results are in',
  playoffs_set: 'Playoff bracket is set',
  season_complete: 'Season complete',
  draft_complete: 'Draft complete',
  league_renewed: 'Renewed for a new season',
  artist_split: 'An artist group was split up',
};

function summarize(item: GlobalActivityItem): string {
  const fixed = FIXED_SUMMARIES[item.type];
  if (fixed) return fixed;
  const clause = item.message.split(/(?::| — | - )/)[0].trim().replace(/\.$/, '');
  return clause.length > 64 ? `${clause.slice(0, 61)}…` : clause;
}

function activityGlyph(type: string): { glyph: string; color: string } {
  if (type.startsWith('trade')) return { glyph: '⇄', color: '#E8B23A' };
  if (type.startsWith('waiver') || type === 'claim') return { glyph: '＋', color: '#E07A3E' };
  if (type === 'member_joined') return { glyph: '＋', color: '#6FA595' };
  if (type === 'week_result' || type === 'season_complete' || type === 'playoffs_set') return { glyph: '♪', color: '#E8B23A' };
  return { glyph: '♪', color: '#A88F70' };
}

function ActivityCard({ items }: { items?: GlobalActivityItem[] }) {
  return (
    <Card className="p-5">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">Around Your Leagues</h3>
      {items && items.length > 0 ? (
        items.slice(0, 5).map((item) => {
          const { glyph, color } = activityGlyph(item.type);
          return (
            <Link
              key={item.id}
              to={`/leagues/${item.leagueId}`}
              className="flex gap-3 py-2.5 border-b border-gray-900 last:border-0 hover:bg-white/5 -mx-2 px-2 rounded-lg transition-colors"
            >
              <div className="w-7 h-7 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-[13px] shrink-0" style={{ color }}>
                {glyph}
              </div>
              <div className="min-w-0">
                <p className="text-[13px] text-gray-300 leading-snug truncate">{summarize(item)}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{item.leagueName} · {timeAgo(item.createdAt)}</p>
              </div>
            </Link>
          );
        })
      ) : (
        <p className="text-sm text-gray-500 py-4 text-center">League activity will show up here.</p>
      )}
    </Card>
  );
}

const HOW_IT_WORKS_FLAG = 'bw_show_how_it_works';

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
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  // Auto-open once after account creation (flag set at signup)
  useEffect(() => {
    if (localStorage.getItem(HOW_IT_WORKS_FLAG)) {
      localStorage.removeItem(HOW_IT_WORKS_FLAG);
      setShowHowItWorks(true);
    }
  }, []);

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

  const { data: movers } = useQuery({
    queryKey: ['chartMovers'],
    queryFn: () => api.get<MoversPayload>('/charts/movers?limit=3'),
  });

  const { data: allActivity } = useQuery({
    queryKey: ['globalActivity'],
    queryFn: () => api.get<{ items: GlobalActivityItem[] }>('/notifications/activity'),
  });

  return (
    <div className="min-h-screen bg-gray-950">

      {showHowItWorks && <HowItWorksModal onClose={() => setShowHowItWorks(false)} />}

      {/* Nav */}
      <header className="relative border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/home" className="flex items-center gap-2">
            <WagonMark size={32} />
            <Wordmark className="text-lg" />
          </Link>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowHowItWorks(true)}
              className="text-gray-400 hover:text-white transition-colors"
              aria-label="How Bandwagoner works"
              title="How Bandwagoner works"
            >
              <HelpCircle className="w-5 h-5" />
            </button>
            <Link to="/account" aria-label="Account" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Avatar src={user?.avatarUrl} name={user?.username ?? '?'} size="sm" />
              <span className="hidden sm:inline text-gray-400 text-sm">{user?.username}</span>
            </Link>
            <Button variant="ghost" size="sm" onClick={logout}>Sign out</Button>
          </div>
        </div>
      </header>

      {notifications && notifications.length > 0 && (
        <div className="relative max-w-5xl mx-auto px-4 pt-4 space-y-2">
          {notifications.map((n) => {
            const isDeletion = n.type === 'league_deleted';
            return (
              <div
                key={n.id}
                className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm ${
                  isDeletion
                    ? 'bg-red-500/10 border border-red-500/20 text-red-300'
                    : 'bg-white/5 border border-white/10 text-gray-300 backdrop-blur-sm'
                }`}
              >
                <span className="flex-1">{n.message}</span>
                <button
                  onClick={() => dismissMutation.mutate(n.id)}
                  className={`shrink-0 transition-colors mt-0.5 ${
                    isDeletion ? 'text-red-400 hover:text-red-200' : 'text-gray-500 hover:text-white'
                  }`}
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
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
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h2 className="font-semibold text-white">{league.name}</h2>
                        <StatusBadge status={league.status} />
                        {league.isCommissioner && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-300">
                            Commissioner
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-400">
                        {league.myTeam.name} · {league.memberCount}/{league.teamCount} teams
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 shrink-0 text-gray-600 group-hover:text-gray-400 transition-colors" />
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

        {/* Charts movers side by side, cross-league activity beneath */}
        <div className="mt-8 space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <MoversCard label="Songs" icon={Music} tab="songs" data={movers?.songs} />
            <MoversCard label="Albums" icon={Disc3} tab="albums" data={movers?.albums} />
          </div>
          <ActivityCard items={allActivity?.items} />
        </div>
      </main>
    </div>
  );
}
