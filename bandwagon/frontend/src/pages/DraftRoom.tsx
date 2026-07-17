import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { Search, Clock, CheckCircle, Circle, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import type { DraftState, DraftPick, Artist } from '../api/types';
import { api } from '../api/client';
import { SlotPill } from '../components/SlotPill';

const ALL_SLOTS = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Other', 'Flex', 'Bench-1', 'Bench-2', 'Bench-3'];

const MAIN_GENRES_DRAFT = new Set(['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country']);
function hasEligibleSlot(genre: string, openSlots: string[]): boolean {
  return openSlots.some((slot) => {
    if (slot.startsWith('Bench') || slot === 'Flex') return true;
    if (slot === 'Other') return !MAIN_GENRES_DRAFT.has(genre);
    return genre === slot;
  });
}

function TimerRing({ seconds, total = 60 }: { seconds: number; total?: number }) {
  const pct = seconds / total;
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  const color = seconds > 20 ? '#E8B23A' : seconds > 10 ? '#E07A3E' : '#C24A2E';

  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="#3A2A1C" strokeWidth="6" />
        <circle
          cx="44" cy="44" r={r} fill="none"
          stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s linear, stroke 0.3s' }}
        />
      </svg>
      <span className="text-2xl font-bold text-white">{seconds}</span>
    </div>
  );
}

function CountdownRing({ seconds, total = 600 }: { seconds: number; total?: number }) {
  const pct = Math.max(0, seconds / total);
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="#3A2A1C" strokeWidth="6" />
        <circle
          cx="44" cy="44" r={r} fill="none"
          stroke="#E8B23A" strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s linear' }}
        />
      </svg>
      <span className="text-sm font-bold text-white font-mono tabular-nums leading-none">
        {m}:{String(s).padStart(2, '0')}
      </span>
    </div>
  );
}

export function DraftRoom() {
  const { id: leagueId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const token = localStorage.getItem('bw_token') ?? '';

  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<DraftState | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [countdownSeconds, setCountdownSeconds] = useState(600);
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const toastIdRef = useRef(0);
  const [availableArtists, setAvailableArtists] = useState<Artist[]>([]);
  const [loadingArtists, setLoadingArtists] = useState(false);
  const [sort, setSort] = useState<{ field: 'name' | 'last' | 'avg'; dir: 'desc' | 'asc' }>({ field: 'last', dir: 'desc' });

  // Tick down the pre-draft countdown locally from the server-provided end time
  useEffect(() => {
    if (!state?.countdownEndsAt) return;
    const tick = () => {
      const remaining = Math.max(0, Math.round((new Date(state.countdownEndsAt!).getTime() - Date.now()) / 1000));
      setCountdownSeconds(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state?.countdownEndsAt]);

  useEffect(() => {
    const socket = io('/', { path: '/socket.io', transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('draft:join', { leagueId, token });
    });

    socket.on('draft:state', (s: DraftState) => {
      setState(s);
      if (s.timerEndsAt) {
        const diff = Math.max(0, Math.round((new Date(s.timerEndsAt).getTime() - Date.now()) / 1000));
        setSecondsLeft(diff);
      }
    });

    socket.on('draft:tick', (s: number) => setSecondsLeft(s));

    socket.on('draft:pick-made', (pick: DraftPick & { artist: Artist; team: { name: string }; isAutoDraft: boolean }) => {
      setState((prev) => prev ? { ...prev, picks: [...prev.picks, pick], currentPickIndex: prev.currentPickIndex + 1 } : prev);
      setSecondsLeft(60);
      const msg = pick.isAutoDraft
        ? `Auto: ${pick.team.name} drafts ${pick.artist.name} (${pick.slot})`
        : `${pick.team.name} drafts ${pick.artist.name} (${pick.slot})`;
      addToast(msg);
    });

    socket.on('draft:complete', () => {
      addToast('Draft complete! Loading scores…');
      setTimeout(() => navigate(`/leagues/${leagueId}`), 5000);
    });

    socket.on('draft:error', (msg: string) => addToast(`Error: ${msg}`));

    return () => { socket.disconnect(); };
  }, [leagueId, token]);

  useEffect(() => {
    fetchArtists();
  }, [search, genreFilter, state?.picks.length]);

  async function fetchArtists() {
    setLoadingArtists(true);
    try {
      const data = await api.get<Artist[]>(`/artists?q=${search}&genre=${genreFilter}&limit=5000`);
      const draftedIds = new Set(state?.picks.map((p) => p.artistId) ?? []);
      setAvailableArtists(data.filter((a) => !draftedIds.has(a.id)));
    } finally {
      setLoadingArtists(false);
    }
  }

  function addToast(msg: string) {
    const id = ++toastIdRef.current;
    setToasts((prev) => [{ id, msg }, ...prev.slice(0, 4)]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 10000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function makePick(artistId: string) {
    socketRef.current?.emit('draft:pick', { leagueId, artistId, token });
  }

  function skipCountdown() {
    socketRef.current?.emit('draft:skip-countdown', { leagueId, token });
  }

  if (!state) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <Spinner className="w-10 h-10 mx-auto mb-4" />
        <p className="text-gray-400">Connecting to draft…</p>
      </div>
    </div>
  );

  const isPreDraft = state.status === 'pre_draft';
  const onClockTeamId = state.pickOrder[state.currentPickIndex];
  const onClockTeam = state.teams.find((t) => t.id === onClockTeamId);
  const isMyTurn = !isPreDraft && onClockTeam?.userId === user?.id;
  const myTeam = state.teams.find((t) => t.userId === user?.id);
  const filledSlots = new Set(state.picks.filter((p) => p.teamId === myTeam?.id).map((p) => p.slot));
  const openSlots = ALL_SLOTS.filter((s) => !filledSlots.has(s));

  const totalPicks = state.teams.length * ALL_SLOTS.length;
  const round = Math.floor(state.currentPickIndex / state.teams.length) + 1;

  const genres = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Other'];

  return (
    <div className="min-h-screen bg-gray-950">

      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-xs">
        {toasts.map(({ id, msg }) => (
          <div key={id} className="flex items-start gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white shadow-xl animate-in slide-in-from-right">
            <span className="flex-1">{msg}</span>
            <button onClick={() => dismissToast(id)} className="shrink-0 text-gray-500 hover:text-white transition-colors mt-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="relative max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Left: timer + my slots */}
          <div className="col-span-12 lg:col-span-3 space-y-4">
            <Card className="p-4 text-center">
              {isPreDraft ? (
                <>
                  <div className="text-xs text-gray-500 mb-2">Draft starting in</div>
                  <CountdownRing seconds={countdownSeconds} />
                  <div className="mt-3 space-y-2">
                    <p className="text-gray-400 text-xs">Browse artists while you wait</p>
                    <Button size="sm" onClick={skipCountdown} className="w-full text-xs">
                      Start Now
                    </Button>
                    <p className="text-xs text-gray-600">Commissioner only</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="font-serif text-sm text-gray-400 mb-2">Round {round} · Pick {state.currentPickIndex + 1} of {totalPicks}</div>
                  <TimerRing seconds={secondsLeft} />
                  <div className="mt-3">
                    {state.isComplete ? (
                      <div className="space-y-2">
                        <p className="text-green-400 font-semibold text-sm">Draft Complete!</p>
                        <Button size="sm" className="w-full text-xs" onClick={() => navigate(`/leagues/${leagueId}`)}>
                          Go to My Team
                        </Button>
                      </div>
                    ) : isMyTurn ? (
                      <p className="text-indigo-400 font-semibold text-sm animate-pulse">Your pick!</p>
                    ) : (
                      <p className="text-gray-400 text-sm">
                        <span className="text-white font-medium">{onClockTeam?.name}</span>
                        <br />is on the clock
                      </p>
                    )}
                  </div>
                </>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">My Slots</h3>
              <div className="space-y-1">
                {ALL_SLOTS.map((slot) => {
                  const filled = filledSlots.has(slot);
                  const pick = state.picks.find((p) => p.teamId === myTeam?.id && p.slot === slot);
                  return (
                    <div key={slot} className="flex items-center gap-2 py-0.5">
                      {filled ? (
                        <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-gray-700 shrink-0" />
                      )}
                      <SlotPill slot={slot} />
                      {filled && pick && (
                        <span className="text-xs text-white truncate">{pick.artist?.name}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Center: artist pool */}
          <div className="col-span-12 lg:col-span-6 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search artists…"
                  className="w-full bg-white/10 border border-white/20 rounded-lg pl-9 pr-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <select
                value={genreFilter}
                onChange={(e) => setGenreFilter(e.target.value)}
                className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All</option>
                {genres.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>

            <Card>
              {/* Sort header */}
              <div className="px-3 py-2 border-b border-gray-700 grid grid-cols-12 gap-1 text-xs uppercase tracking-wider font-medium">
                <div className="col-span-5">
                  <button
                    onClick={() => setSort((p) => p.field === 'name' ? { field: 'name', dir: p.dir === 'desc' ? 'asc' : 'desc' } : { field: 'name', dir: 'desc' })}
                    className={`flex items-center gap-1 hover:text-white transition-colors ${sort.field === 'name' ? 'text-indigo-400' : 'text-gray-500'}`}
                  >
                    Artist {sort.field === 'name' ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}
                  </button>
                </div>
                <div className="col-span-3 text-right">
                  <button
                    onClick={() => setSort((p) => p.field === 'last' ? { field: 'last', dir: p.dir === 'desc' ? 'asc' : 'desc' } : { field: 'last', dir: 'desc' })}
                    className={`flex items-center justify-end gap-1 w-full hover:text-white transition-colors ${sort.field === 'last' ? 'text-indigo-400' : 'text-gray-500'}`}
                  >
                    Last {sort.field === 'last' ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}
                  </button>
                </div>
                <div className="col-span-2 text-right">
                  <button
                    onClick={() => setSort((p) => p.field === 'avg' ? { field: 'avg', dir: p.dir === 'desc' ? 'asc' : 'desc' } : { field: 'avg', dir: 'desc' })}
                    className={`flex items-center justify-end gap-1 w-full hover:text-white transition-colors ${sort.field === 'avg' ? 'text-indigo-400' : 'text-gray-500'}`}
                  >
                    5W Avg {sort.field === 'avg' ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}
                  </button>
                </div>
                <div className="col-span-2" />
              </div>
              {loadingArtists ? (
                <div className="flex justify-center py-8"><Spinner className="w-6 h-6" /></div>
              ) : (
                <div className="divide-y divide-gray-900 max-h-[55vh] overflow-y-auto">
                  {[...availableArtists]
                    .sort((a, b) => {
                      let cmp = 0;
                      if (sort.field === 'name') cmp = a.name.localeCompare(b.name);
                      else if (sort.field === 'last') cmp = (a.lastWeekPoints ?? 0) - (b.lastWeekPoints ?? 0);
                      else cmp = (a.avgLast5Points ?? 0) - (b.avgLast5Points ?? 0);
                      return sort.dir === 'desc' ? -cmp : cmp;
                    })
                    .map((artist) => {
                      const canDraft = isMyTurn && hasEligibleSlot(artist.primaryGenre, openSlots);
                      return (
                        <div key={artist.id} className="grid grid-cols-12 items-center gap-1 p-3 hover:bg-white/5 transition-colors">
                          <a
                            href={`/artists/${artist.id}?leagueId=${leagueId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="col-span-5 flex items-center gap-2 min-w-0 group"
                          >
                            <Avatar src={artist.imageUrl} name={artist.name} size="sm" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-white truncate group-hover:text-indigo-300 transition-colors">{artist.name}</div>
                              <Badge genre={artist.primaryGenre}>{artist.primaryGenre}</Badge>
                            </div>
                          </a>
                          <div className="col-span-3 text-right font-serif text-[15px] text-gray-300">
                            {(artist.lastWeekPoints ?? 0).toFixed(1)}
                          </div>
                          <div className="col-span-2 text-right font-serif text-[15px] text-gray-400">
                            {(artist.avgLast5Points ?? 0).toFixed(1)}
                          </div>
                          <div className="col-span-2 flex justify-end">
                            {isMyTurn && (
                              <Button
                                size="sm"
                                disabled={!canDraft}
                                onClick={() => makePick(artist.id)}
                                title={!canDraft ? 'No eligible slot on your roster' : undefined}
                              >
                                Draft
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  {availableArtists.length === 0 && (
                    <div className="text-center py-8 text-gray-500 text-sm">No artists found</div>
                  )}
                </div>
              )}
            </Card>
          </div>

          {/* Right: recent picks / team list during pre-draft */}
          <div className="col-span-12 lg:col-span-3">
            <Card className="p-4">
              {isPreDraft ? (
                <>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    Teams ({state.teams.length})
                  </h3>
                  <div className="space-y-2">
                    {state.teams.map((team) => (
                      <div key={team.id} className="flex items-center gap-2 py-1">
                        <Avatar src={team.user?.avatarUrl ?? null} name={team.user?.username ?? team.name} size="sm" />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white truncate">{team.name}</div>
                          <div className="text-xs text-gray-600">{team.user?.username ?? ''}</div>
                        </div>
                        {team.draftPosition != null && (
                          <span className="ml-auto text-xs text-gray-600 font-serif shrink-0">#{team.draftPosition}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent Picks</h3>
                  <div className="space-y-2 max-h-[70vh] overflow-y-auto">
                    {[...state.picks].reverse().map((pick) => (
                      <div key={pick.id} className="flex items-center gap-2 py-1.5 border-b border-gray-900 last:border-0">
                        <div className="shrink-0">
                          <Avatar src={pick.artist?.imageUrl} name={pick.artist?.name ?? '?'} size="sm" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-white truncate">{pick.artist?.name}</div>
                          <div className="text-xs text-gray-600">{pick.team?.name} · {pick.slot}</div>
                        </div>
                        <div className="text-xs text-gray-600 font-serif">#{pick.pickNumber}</div>
                      </div>
                    ))}
                    {state.picks.length === 0 && (
                      <p className="text-xs text-gray-600 text-center py-4">No picks yet</p>
                    )}
                  </div>
                </>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
