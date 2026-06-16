import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { Search, Clock, CheckCircle, Circle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import type { DraftState, DraftPick, Artist } from '../api/types';
import { api } from '../api/client';

const ALL_SLOTS = ['Hip-Hop', 'Pop', 'Rock', 'Country', 'Niche', 'Flex', 'Bench-1', 'Bench-2', 'Bench-3'];

function isEligibleClientSide(genre: string, slot: string): boolean {
  if (slot.startsWith('Bench') || slot === 'Flex') return true;
  if (slot === 'Niche') return !['Hip-Hop', 'Pop', 'Rock', 'Country'].includes(genre);
  return genre === slot;
}

function TimerRing({ seconds, total = 60 }: { seconds: number; total?: number }) {
  const pct = seconds / total;
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  const color = seconds > 20 ? '#6366f1' : seconds > 10 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="#1f2937" strokeWidth="6" />
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

export function DraftRoom() {
  const { id: leagueId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const token = localStorage.getItem('bw_token') ?? '';

  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<DraftState | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [toasts, setToasts] = useState<string[]>([]);
  const [availableArtists, setAvailableArtists] = useState<Artist[]>([]);
  const [loadingArtists, setLoadingArtists] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [sort, setSort] = useState<{ field: 'name' | 'last' | 'avg'; dir: 'desc' | 'asc' }>({ field: 'last', dir: 'desc' });

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
      addToast('Draft complete! Rosters are set.');
      setTimeout(() => navigate(`/leagues/${leagueId}`), 2000);
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
      const data = await api.get<Artist[]>(`/artists?q=${search}&genre=${genreFilter}`);
      const draftedIds = new Set(state?.picks.map((p) => p.artistId) ?? []);
      setAvailableArtists(data.filter((a) => !draftedIds.has(a.id)));
    } finally {
      setLoadingArtists(false);
    }
  }

  function addToast(msg: string) {
    setToasts((prev) => [msg, ...prev.slice(0, 4)]);
  }

  function makePick(artistId: string, slot: string) {
    socketRef.current?.emit('draft:pick', { leagueId, artistId, slot, token });
  }

  if (!state) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <Spinner className="w-10 h-10 mx-auto mb-4" />
        <p className="text-gray-400">Connecting to draft…</p>
      </div>
    </div>
  );

  const onClockTeamId = state.pickOrder[state.currentPickIndex];
  const onClockTeam = state.teams.find((t) => t.id === onClockTeamId);
  const isMyTurn = onClockTeam?.userId === user?.id;
  const myTeam = state.teams.find((t) => t.userId === user?.id);
  const filledSlots = new Set(state.picks.filter((p) => p.teamId === myTeam?.id).map((p) => p.slot));
  const openSlots = ALL_SLOTS.filter((s) => !filledSlots.has(s));

  const totalPicks = state.teams.length * ALL_SLOTS.length;
  const round = Math.floor(state.currentPickIndex / state.teams.length) + 1;

  const genres = ['Hip-Hop', 'Pop', 'Rock', 'Country', 'Latin', 'Dance/Electronic', 'R&B', 'World'];

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/30 via-gray-950 to-purple-950/20 pointer-events-none" />

      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-xs">
        {toasts.map((t, i) => (
          <div key={i} className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white shadow-xl animate-in slide-in-from-right">
            {t}
          </div>
        ))}
      </div>

      <div className="relative max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Left: timer + my slots */}
          <div className="col-span-12 lg:col-span-3 space-y-4">
            <Card className="p-4 text-center">
              <div className="text-xs text-gray-500 mb-2">Round {round} · Pick {state.currentPickIndex + 1} of {totalPicks}</div>
              <TimerRing seconds={secondsLeft} />
              <div className="mt-3">
                {state.isComplete ? (
                  <p className="text-green-400 font-semibold text-sm">Draft Complete!</p>
                ) : isMyTurn ? (
                  <p className="text-indigo-400 font-semibold text-sm animate-pulse">Your pick!</p>
                ) : (
                  <p className="text-gray-400 text-sm">
                    <span className="text-white font-medium">{onClockTeam?.name}</span>
                    <br />is on the clock
                  </p>
                )}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">My Slots</h3>
              <div className="space-y-1">
                {ALL_SLOTS.map((slot) => {
                  const filled = filledSlots.has(slot);
                  const pick = state.picks.find((p) => p.teamId === myTeam?.id && p.slot === slot);
                  return (
                    <div key={slot} className="flex items-center gap-2 text-sm">
                      {filled ? (
                        <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-gray-700 shrink-0" />
                      )}
                      <span className={`${slot.startsWith('Bench') ? 'text-gray-600' : 'text-gray-400'} text-xs`}>
                        {slot.startsWith('Bench') ? 'Bench' : slot}
                      </span>
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

            {isMyTurn && openSlots.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                <span className="text-xs text-gray-500 self-center">Draft to:</span>
                {openSlots.map((slot) => (
                  <button
                    key={slot}
                    onClick={() => setSelectedSlot(slot === selectedSlot ? '' : slot)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${selectedSlot === slot ? 'bg-indigo-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                  >
                    {slot.startsWith('Bench') ? 'Bench' : slot}
                  </button>
                ))}
              </div>
            )}

            <Card>
              {/* Sort header */}
              <div className="px-3 py-2 border-b border-white/10 grid grid-cols-12 gap-1 text-xs uppercase tracking-wider font-medium">
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
                <div className="col-span-4 text-right">
                  <button
                    onClick={() => setSort((p) => p.field === 'avg' ? { field: 'avg', dir: p.dir === 'desc' ? 'asc' : 'desc' } : { field: 'avg', dir: 'desc' })}
                    className={`flex items-center justify-end gap-1 w-full hover:text-white transition-colors ${sort.field === 'avg' ? 'text-indigo-400' : 'text-gray-500'}`}
                  >
                    5W Avg {sort.field === 'avg' ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}
                  </button>
                </div>
              </div>
              {loadingArtists ? (
                <div className="flex justify-center py-8"><Spinner className="w-6 h-6" /></div>
              ) : (
                <div className="divide-y divide-white/5 max-h-[55vh] overflow-y-auto">
                  {[...availableArtists]
                    .sort((a, b) => {
                      let cmp = 0;
                      if (sort.field === 'name') cmp = a.name.localeCompare(b.name);
                      else if (sort.field === 'last') cmp = (a.lastWeekPoints ?? 0) - (b.lastWeekPoints ?? 0);
                      else cmp = (a.avgLast5Points ?? 0) - (b.avgLast5Points ?? 0);
                      return sort.dir === 'desc' ? -cmp : cmp;
                    })
                    .map((artist) => {
                      const eligible = selectedSlot ? isEligibleClientSide(artist.primaryGenre, selectedSlot) : true;
                      return (
                        <div key={artist.id} className={`grid grid-cols-12 items-center gap-1 p-3 hover:bg-white/5 transition-colors ${!eligible ? 'opacity-40' : ''}`}>
                          <div className="col-span-5 flex items-center gap-2 min-w-0">
                            <Avatar src={artist.imageUrl} name={artist.name} size="sm" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-white truncate">{artist.name}</div>
                              <Badge genre={artist.primaryGenre}>{artist.primaryGenre}</Badge>
                            </div>
                          </div>
                          <div className="col-span-3 text-right font-mono text-sm text-gray-300">
                            {(artist.lastWeekPoints ?? 0).toFixed(1)}
                          </div>
                          <div className="col-span-4 text-right flex items-center justify-end gap-2">
                            <span className="font-mono text-sm text-gray-400">{(artist.avgLast5Points ?? 0).toFixed(1)}</span>
                            {isMyTurn && selectedSlot && eligible && (
                              <Button size="sm" onClick={() => makePick(artist.id, selectedSlot)}>
                                Draft
                              </Button>
                            )}
                            {isMyTurn && !selectedSlot && (
                              <span className="text-xs text-gray-600 whitespace-nowrap">Pick slot →</span>
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

          {/* Right: recent picks feed */}
          <div className="col-span-12 lg:col-span-3">
            <Card className="p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent Picks</h3>
              <div className="space-y-2 max-h-[70vh] overflow-y-auto">
                {[...state.picks].reverse().map((pick) => (
                  <div key={pick.id} className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0">
                    <div className="shrink-0">
                      <Avatar src={pick.artist?.imageUrl} name={pick.artist?.name ?? '?'} size="sm" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">{pick.artist?.name}</div>
                      <div className="text-xs text-gray-600">{pick.team?.name} · {pick.slot}</div>
                    </div>
                    <div className="text-xs text-gray-600 font-mono">#{pick.pickNumber}</div>
                  </div>
                ))}
                {state.picks.length === 0 && (
                  <p className="text-xs text-gray-600 text-center py-4">No picks yet</p>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
