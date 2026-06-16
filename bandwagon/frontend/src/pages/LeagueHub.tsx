import { useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Music2, ChevronLeft, Trophy, Users, Settings, Swords, Search, ArrowUpDown, User, Pencil, X, Check } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import type { League, Matchup, StandingsEntry, PlayerEntry, RosterSpot, Team } from '../api/types';

type Tab = 'myteam' | 'matchup' | 'standings' | 'players' | 'settings';

const ALL_STARTER_SLOTS = ['Hip-Hop', 'Pop', 'Rock', 'Country', 'Niche', 'Flex'];
const ALL_BENCH_SLOTS = ['Bench-1', 'Bench-2', 'Bench-3'];

function SlotLabel({ slot }: { slot: string }) {
  const colors: Record<string, string> = {
    'Hip-Hop': 'text-purple-400', 'Pop': 'text-pink-400', 'Rock': 'text-orange-400',
    'Country': 'text-amber-400', 'Niche': 'text-teal-400', 'Flex': 'text-indigo-400',
    'Bench-1': 'text-gray-500', 'Bench-2': 'text-gray-500', 'Bench-3': 'text-gray-500',
  };
  const display = slot.startsWith('Bench') ? 'Bench' : slot;
  return <span className={`text-xs font-semibold uppercase tracking-wider ${colors[slot] || 'text-gray-400'}`}>{display}</span>;
}

function RosterRow({ spot, onSwapSelect, selectedSlot, readOnly = false, compact = false, reverse = false }: {
  spot: RosterSpot;
  onSwapSelect?: (slot: string) => void;
  selectedSlot?: string | null;
  readOnly?: boolean;
  compact?: boolean;
  reverse?: boolean;
}) {
  const score = spot.artist?.weeklyScores?.[0];
  const isBench = spot.slot.startsWith('Bench');
  const isSelected = !readOnly && selectedSlot === spot.slot;

  return (
    <div
      className={`flex items-center gap-3 rounded-lg transition-colors ${compact ? 'p-2 gap-2' : 'p-3'} ${reverse ? 'flex-row-reverse' : ''} ${
        readOnly
          ? ''
          : `cursor-pointer ${isSelected ? 'bg-indigo-500/20 border border-indigo-500/50' : 'hover:bg-white/5 border border-transparent'}`
      }`}
      onClick={readOnly ? undefined : () => onSwapSelect?.(spot.slot)}
    >
      {!compact && (
        <div className={`shrink-0 w-16 ${reverse ? 'text-right' : ''}`}>
          <SlotLabel slot={spot.slot} />
        </div>
      )}
      {spot.artist ? (
        <>
          <Avatar src={spot.artist.imageUrl} name={spot.artist.name} size="sm" />
          <div className={`flex-1 min-w-0 ${reverse ? 'text-right' : ''}`}>
            {compact && <SlotLabel slot={spot.slot} />}
            <Link to={`/artists/${spot.artist.id}`} onClick={(e) => e.stopPropagation()} className={`font-medium text-white hover:text-indigo-400 transition-colors truncate block ${compact ? 'text-xs' : 'text-sm'}`}>
              {spot.artist.name}
            </Link>
            {!compact && <Badge genre={spot.artist.primaryGenre} className="mt-0.5">{spot.artist.primaryGenre}</Badge>}
          </div>
          <div className="text-right shrink-0">
            <div className={`font-bold ${compact ? 'text-sm' : 'text-base'} ${isBench ? 'text-gray-500' : 'text-white'}`}>
              {score ? score.totalPoints.toFixed(1) : '—'}
            </div>
            {!compact && <div className="text-xs text-gray-600">pts</div>}
          </div>
        </>
      ) : (
        <>
          {compact && <Avatar src={null} name="?" size="sm" />}
          <div className={`flex-1 min-w-0 ${reverse ? 'text-right' : ''}`}>
            {compact && <SlotLabel slot={spot.slot} />}
            <span className="text-sm text-gray-600">Empty slot</span>
          </div>
          <span className="text-xs text-gray-600 shrink-0">—</span>
        </>
      )}
    </div>
  );
}

function getRosterSpot(roster: RosterSpot[], slot: string): RosterSpot {
  return roster.find((s) => s.slot === slot) ?? { id: '', teamId: '', artistId: null, slot, artist: null };
}

function TeamRosterCard({ title, roster, reverse = false }: { title: string; roster: RosterSpot[]; reverse?: boolean }) {
  return (
    <Card className="p-3">
      <h3 className={`text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 truncate ${reverse ? 'text-right' : ''}`}>{title}</h3>
      <div className="space-y-1">
        {ALL_STARTER_SLOTS.map((slot) => (
          <RosterRow key={slot} spot={getRosterSpot(roster, slot)} readOnly compact reverse={reverse} />
        ))}
      </div>
      <div className={`text-xs font-semibold text-gray-500 uppercase tracking-wider mt-2 mb-1 ${reverse ? 'text-right' : ''}`}>Bench</div>
      <div className="space-y-1">
        {ALL_BENCH_SLOTS.map((slot) => (
          <RosterRow key={slot} spot={getRosterSpot(roster, slot)} readOnly compact reverse={reverse} />
        ))}
      </div>
    </Card>
  );
}

const MAX_LOGO_SIZE = 5 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function MyTeamTab({ leagueId, league }: { leagueId: string; league: League }) {
  const queryClient = useQueryClient();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  // Team identity editing
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLogoFile, setEditLogoFile] = useState<File | null>(null);
  const [editLogoPreview, setEditLogoPreview] = useState<string | null>(null);
  const [editFileError, setEditFileError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: myTeam, isLoading } = useQuery({
    queryKey: ['myTeam', leagueId],
    queryFn: () => api.get<Team & { rosterSpots: RosterSpot[] }>(`/leagues/${leagueId}/roster`),
  });

  const swapMutation = useMutation({
    mutationFn: ({ slotA, slotB }: { slotA: string; slotB: string }) =>
      api.put(`/leagues/${leagueId}/roster/lineup`, { slotA, slotB }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['myTeam', leagueId] }),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Spinner className="w-8 h-8" /></div>;
  if (!myTeam) return (
    <div className="text-center py-12 text-gray-400">
      {league.status === 'pending' ? 'Season hasn\'t started yet. Draft a team first!' : 'No team found.'}
    </div>
  );

  function startEditing() {
    setEditName(myTeam!.name);
    setEditLogoFile(null);
    setEditLogoPreview(null);
    setEditFileError('');
    setEditError('');
    setEditing(true);
  }

  function cancelEditing() {
    if (editLogoPreview) URL.revokeObjectURL(editLogoPreview);
    setEditing(false);
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setEditFileError('Only JPEG, PNG, or WebP images are allowed');
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      setEditFileError('Image must be smaller than 5MB');
      return;
    }
    setEditFileError('');
    if (editLogoPreview) URL.revokeObjectURL(editLogoPreview);
    setEditLogoFile(file);
    setEditLogoPreview(URL.createObjectURL(file));
  }

  async function handleSaveIdentity() {
    setEditSaving(true);
    setEditError('');
    try {
      const formData = new FormData();
      if (editName.trim()) formData.append('name', editName.trim());
      if (editLogoFile) formData.append('logo', editLogoFile);
      await api.put(`/leagues/${leagueId}/team`, formData);
      await queryClient.invalidateQueries({ queryKey: ['myTeam', leagueId] });
      if (editLogoPreview) URL.revokeObjectURL(editLogoPreview);
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setEditSaving(false);
    }
  }

  function handleSlotClick(slot: string) {
    if (!selectedSlot) { setSelectedSlot(slot); return; }
    if (selectedSlot === slot) { setSelectedSlot(null); return; }
    swapMutation.mutate({ slotA: selectedSlot, slotB: slot });
    setSelectedSlot(null);
  }

  const myRoster = myTeam.rosterSpots ?? [];
  const displayLogoUrl = editLogoPreview ?? myTeam.logoUrl ?? undefined;

  function getSpot(slot: string): RosterSpot {
    return getRosterSpot(myRoster, slot);
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        {editing ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <Avatar src={displayLogoUrl} name={editName || '?'} size="xl" />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-indigo-500 border-2 border-gray-950 flex items-center justify-center hover:bg-indigo-400 transition-colors"
                >
                  <Pencil className="w-3 h-3 text-white" />
                </button>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleLogoChange} className="hidden" />
              </div>
              <div className="flex-1 min-w-0">
                <label className="text-xs font-medium text-gray-400 mb-1 block">Team Name</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={30}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {editFileError && <p className="text-xs text-red-400 mt-1">{editFileError}</p>}
              </div>
            </div>
            {editError && <p className="text-xs text-red-400">{editError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleSaveIdentity}
                disabled={editSaving || !editName.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                {editSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={cancelEditing}
                disabled={editSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-gray-300 text-sm font-medium transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Avatar src={myTeam.logoUrl ?? undefined} name={myTeam.name} size="xl" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-500 mb-0.5">Week {league.currentWeek}</div>
              <div className="font-semibold text-white text-lg truncate">{myTeam.name}</div>
            </div>
            <button
              onClick={startEditing}
              className="shrink-0 p-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
              title="Edit team name & logo"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        )}
      </Card>

      {selectedSlot && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-3 text-sm text-indigo-300 flex items-center justify-between">
          <span>Select a second slot to swap with <strong>{selectedSlot}</strong></span>
          <button onClick={() => setSelectedSlot(null)} className="text-indigo-400 hover:text-white text-xs">Cancel</button>
        </div>
      )}

      {swapMutation.isError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
          {(swapMutation.error as Error).message}
        </div>
      )}

      {/* Starters */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Starters</h3>
          <div className="flex items-center gap-1 text-xs text-gray-600">
            <ArrowUpDown className="w-3 h-3" />
            Tap two slots to swap
          </div>
        </div>
        <div className="space-y-1">
          {ALL_STARTER_SLOTS.map((slot) => (
            <RosterRow key={slot} spot={getSpot(slot)} onSwapSelect={handleSlotClick} selectedSlot={selectedSlot} />
          ))}
        </div>
      </Card>

      {/* Bench */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Bench</h3>
        <div className="space-y-1">
          {ALL_BENCH_SLOTS.map((slot) => (
            <RosterRow key={slot} spot={getSpot(slot)} onSwapSelect={handleSlotClick} selectedSlot={selectedSlot} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function MatchupTab({ leagueId, league }: { leagueId: string; league: League }) {
  const { user } = useAuth();

  const { data: matchup, isLoading } = useQuery({
    queryKey: ['matchup', leagueId, 'current'],
    queryFn: () => api.get<Matchup | null>(`/leagues/${leagueId}/matchups/current`),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Spinner className="w-8 h-8" /></div>;
  if (!matchup) return (
    <div className="text-center py-12 text-gray-400">
      {league.status === 'pending' ? 'Season hasn\'t started yet. Draft a team first!' : 'No matchup this week.'}
    </div>
  );

  const isHome = matchup.homeTeam?.user && 'id' in (matchup.homeTeam ?? {}) && matchup.homeTeamId && matchup.homeTeam &&
    matchup.homeTeam.userId === user?.id;
  const myTeamData = isHome ? matchup.homeTeam : matchup.awayTeam;
  const oppTeamData = isHome ? matchup.awayTeam : matchup.homeTeam;
  const myScore = isHome ? matchup.homeScore : matchup.awayScore;
  const oppScore = isHome ? matchup.awayScore : matchup.homeScore;

  return (
    <div className="space-y-4">
      {/* Head-to-head header */}
      <Card className="p-5">
        <div className="text-center text-xs text-gray-500 mb-3">Week {league.currentWeek} · updates daily</div>
        <div className="flex items-center justify-center gap-6">
          <div className="text-center">
            <div className="font-semibold text-white mb-1">{myTeamData?.name ?? 'Your Team'}</div>
            <div className={`text-3xl font-bold ${myScore >= oppScore ? 'text-green-400' : 'text-white'}`}>
              {myScore.toFixed(1)}
            </div>
          </div>
          <div className="text-gray-600 text-lg font-light">vs</div>
          <div className="text-center">
            <div className="font-semibold text-white mb-1">{oppTeamData?.name ?? 'Opponent'}</div>
            <div className={`text-3xl font-bold ${oppScore > myScore ? 'text-green-400' : 'text-white'}`}>
              {oppScore.toFixed(1)}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <TeamRosterCard title={myTeamData?.name ?? 'Your Team'} roster={myTeamData?.rosterSpots ?? []} />
        <TeamRosterCard title={oppTeamData?.name ?? 'Opponent'} roster={oppTeamData?.rosterSpots ?? []} reverse />
      </div>
    </div>
  );
}

function StandingsTab({ leagueId, league }: { leagueId: string; league: League }) {
  const { data, isLoading } = useQuery({
    queryKey: ['standings', leagueId],
    queryFn: () => api.get<StandingsEntry[]>(`/leagues/${leagueId}/standings`),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Spinner className="w-8 h-8" /></div>;

  const playoffCutline = 4;

  return (
    <Card>
      <div className="p-4 border-b border-white/10">
        <div className="grid grid-cols-12 text-xs text-gray-500 uppercase tracking-wider font-medium">
          <div className="col-span-1">#</div>
          <div className="col-span-5">Team</div>
          <div className="col-span-3 text-center">W-L</div>
          <div className="col-span-3 text-right">Pts For</div>
        </div>
      </div>
      {data?.map((entry, i) => (
        <div key={entry.teamId}>
          {i === playoffCutline && (
            <div className="px-4 py-1 bg-purple-500/10 text-center text-xs text-purple-400 border-y border-purple-500/20">
              ── Playoff Line ──
            </div>
          )}
          <div className="grid grid-cols-12 items-center p-4 hover:bg-white/5 transition-colors">
            <div className="col-span-1 text-gray-500 font-mono text-sm">{entry.rank}</div>
            <div className="col-span-5 flex items-center gap-2">
              <Avatar src={entry.avatarUrl} name={entry.username ?? '?'} size="sm" />
              <div>
                <div className="text-sm font-medium text-white">{entry.teamName}</div>
                <div className="text-xs text-gray-500">{entry.username}</div>
              </div>
            </div>
            <div className="col-span-3 text-center text-sm font-semibold text-white">
              {entry.wins}-{entry.losses}
            </div>
            <div className="col-span-3 text-right text-sm text-gray-300 font-mono">
              {entry.pointsFor.toFixed(1)}
            </div>
          </div>
        </div>
      ))}
    </Card>
  );
}

type SortField = 'name' | 'last' | 'avg';
type SortDir = 'desc' | 'asc';

function SortHeader({ label, field, sort, onSort }: {
  label: string;
  field: SortField;
  sort: { field: SortField; dir: SortDir };
  onSort: (f: SortField) => void;
}) {
  const active = sort.field === field;
  return (
    <button
      onClick={() => onSort(field)}
      className={`flex items-center gap-1 hover:text-white transition-colors ${active ? 'text-indigo-400' : 'text-gray-500'}`}
    >
      {label}
      <span className="text-xs">{active ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}</span>
    </button>
  );
}

function PlayersTab({ leagueId }: { leagueId: string }) {
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('');
  const [freeAgentsOnly, setFreeAgentsOnly] = useState(false);
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'last', dir: 'desc' });

  const { data, isLoading } = useQuery({
    queryKey: ['players', leagueId, search, genre],
    queryFn: () => api.get<PlayerEntry[]>(`/leagues/${leagueId}/players?q=${search}&genre=${genre}`),
    placeholderData: (prev) => prev,
  });

  const genres = ['Hip-Hop', 'Pop', 'Rock', 'Country', 'Latin', 'Dance/Electronic', 'R&B', 'World'];

  function handleSort(field: SortField) {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
        : { field, dir: field === 'name' ? 'desc' : 'desc' }
    );
  }

  const filtered = freeAgentsOnly ? (data ?? []).filter((a) => !a.rosteredBy) : (data ?? []);

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sort.field === 'name') cmp = a.name.localeCompare(b.name);
    else if (sort.field === 'last') cmp = (a.lastWeekPoints ?? 0) - (b.lastWeekPoints ?? 0);
    else cmp = (a.avgLast5Points ?? 0) - (b.avgLast5Points ?? 0);
    return sort.dir === 'desc' ? -cmp : cmp;
  });

  return (
    <div className="space-y-4">
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
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Genres</option>
          {genres.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <button
          onClick={() => setFreeAgentsOnly((v) => !v)}
          aria-pressed={freeAgentsOnly}
          className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap ${
            freeAgentsOnly
              ? 'bg-green-500/20 border-green-500/30 text-green-400'
              : 'bg-white/10 border-white/20 text-gray-300 hover:bg-white/20'
          }`}
        >
          Free Agents Only
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner className="w-6 h-6" /></div>
      ) : (
        <Card>
          <div className="p-3 border-b border-white/10">
            <div className="grid grid-cols-12 gap-1 text-xs uppercase tracking-wider font-medium">
              <div className="col-span-5">
                <SortHeader label="Artist" field="name" sort={sort} onSort={handleSort} />
              </div>
              <div className="col-span-2 flex justify-end">
                <SortHeader label="Last" field="last" sort={sort} onSort={handleSort} />
              </div>
              <div className="col-span-2 flex justify-end">
                <SortHeader label="5W Avg" field="avg" sort={sort} onSort={handleSort} />
              </div>
              <div className="col-span-3 flex justify-end text-gray-500">Status</div>
            </div>
          </div>
          <div className="divide-y divide-white/5">
            {sorted.map((artist) => (
              <div key={artist.id} className="p-3 hover:bg-white/5 transition-colors">
                <div className="grid grid-cols-12 items-center gap-1">
                  <div className="col-span-5 flex items-center gap-2 min-w-0">
                    <Avatar src={artist.imageUrl} name={artist.name} size="sm" />
                    <div className="min-w-0">
                      <Link to={`/artists/${artist.id}`} className="text-sm font-medium text-white hover:text-indigo-400 transition-colors block truncate">
                        {artist.name}
                      </Link>
                      <Badge genre={artist.primaryGenre} className="mt-0.5">{artist.primaryGenre}</Badge>
                    </div>
                  </div>
                  <div className="col-span-2 text-right font-mono text-sm font-semibold text-white">
                    {(artist.lastWeekPoints ?? 0).toFixed(1)}
                  </div>
                  <div className="col-span-2 text-right font-mono text-sm text-gray-300">
                    {(artist.avgLast5Points ?? 0).toFixed(1)}
                  </div>
                  <div className="col-span-3 text-right">
                    {artist.rosteredBy ? (
                      <span className="text-xs text-gray-500 truncate block">@{artist.rosteredBy.name}</span>
                    ) : (
                      <span className="text-xs text-green-400 font-medium">Free Agent</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function SettingsTab({ leagueId, league }: { leagueId: string; league: League }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isCommissioner = league.commissionerId === user?.id;
  const isLocked = league.status !== 'pending';

  const [name, setName] = useState(league.name);
  const [draftTime, setDraftTime] = useState(
    league.draftTime ? new Date(league.draftTime).toISOString().slice(0, 16) : ''
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const navigate = useNavigate();

  async function handleDelete() {
    setDeleting(true);
    setDeleteError('');
    try {
      await api.del(`/leagues/${leagueId}`);
      queryClient.invalidateQueries({ queryKey: ['leagues'] });
      navigate('/home');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
      setDeleting(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.put(`/leagues/${leagueId}`, { name, draftTime: draftTime || null });
      queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const inviteUrl = `${window.location.origin}/leagues/join/${league.inviteCode}`;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Invite</h3>
        <div className="flex items-center gap-2 bg-white/5 rounded-lg p-3 mb-2">
          <span className="flex-1 text-sm text-gray-300 truncate">{inviteUrl}</span>
          <button
            onClick={() => navigator.clipboard.writeText(inviteUrl)}
            className="text-indigo-400 hover:text-indigo-300 text-xs shrink-0"
          >
            Copy
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Code:</span>
          <span className="font-mono text-sm font-semibold text-white tracking-widest">{league.inviteCode}</span>
          <button
            onClick={() => navigator.clipboard.writeText(league.inviteCode)}
            className="text-indigo-400 hover:text-indigo-300 text-xs ml-1"
          >
            Copy
          </button>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">League Settings</h3>
          {isLocked && <span className="text-xs text-yellow-500">Locked (season started)</span>}
        </div>

        {isCommissioner && !isLocked ? (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-300">League Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-300">Draft Date & Time</label>
              <input
                type="datetime-local"
                value={draftTime}
                onChange={(e) => setDraftTime(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-300">Team Count</label>
              <div className="text-white font-medium">{league.teamCount} teams</div>
              <p className="text-xs text-gray-600">Team count cannot be changed after creation</p>
            </div>
            {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{error}</div>}
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
            </Button>
          </form>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Name</span>
              <span className="text-white">{league.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Privacy</span>
              <span className="text-white capitalize">{league.privacy}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Teams</span>
              <span className="text-white">{league.teamCount}</span>
            </div>
            {league.draftTime && (
              <div className="flex justify-between">
                <span className="text-gray-500">Draft Time</span>
                <span className="text-white">{new Date(league.draftTime).toLocaleString()}</span>
              </div>
            )}
            {!isCommissioner && <p className="text-xs text-gray-600">Only the commissioner can edit settings</p>}
          </div>
        )}
      </Card>

      {isCommissioner && league.status === 'pending' && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Draft</h3>
          <p className="text-sm text-gray-400 mb-4">Start the draft when all teams have joined</p>
          <Button
            onClick={async () => {
              try {
                await api.post(`/leagues/${leagueId}/draft/start`, {});
                navigate(`/leagues/${leagueId}/draft`);
              } catch (err) {
                alert(err instanceof Error ? err.message : 'Failed to start draft');
              }
            }}
            className="w-full"
          >
            Start Draft Now
          </Button>
        </Card>
      )}

      {isCommissioner && (
        <Card className="p-5 border-red-500/20">
          <h3 className="text-sm font-semibold text-red-400/70 uppercase tracking-wider mb-4">Danger Zone</h3>
          {!confirmDelete ? (
            <div>
              <p className="text-sm text-gray-400 mb-4">
                Permanently delete this league. All members will be notified the next time they log in.
              </p>
              <Button variant="danger" className="w-full" onClick={() => setConfirmDelete(true)}>
                Delete League
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-red-300">
                Are you sure? This cannot be undone. All teams, rosters, and matchup history will be lost.
              </p>
              {deleteError && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{deleteError}</div>
              )}
              <div className="flex gap-2">
                <Button variant="danger" className="flex-1" onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Yes, delete it'}
                </Button>
                <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export function LeagueHub() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('myteam');
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: league, isLoading } = useQuery({
    queryKey: ['league', id],
    queryFn: () => api.get<League & { teams: Team[]; commissioner: { id: string; username: string | null } }>(`/leagues/${id}`),
  });

  if (isLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><Spinner className="w-8 h-8" /></div>;
  if (!league) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">League not found</div>;

  const isCommissioner = league.commissionerId === user?.id;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'myteam', label: 'My Team', icon: <User className="w-4 h-4" /> },
    { id: 'matchup', label: 'Matchup', icon: <Swords className="w-4 h-4" /> },
    { id: 'standings', label: 'Standings', icon: <Trophy className="w-4 h-4" /> },
    { id: 'players', label: 'Players', icon: <Users className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/20 via-gray-950 to-purple-950/10 pointer-events-none" />

      <header className="relative border-b border-white/10 sticky top-0 bg-gray-950/80 backdrop-blur-sm z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/home" className="text-gray-400 hover:text-white transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 flex items-center gap-2">
            <Music2 className="w-4 h-4 text-indigo-400" />
            <span className="font-semibold text-white text-sm">{league.name}</span>
          </div>
          {league.status === 'pending' && isCommissioner && (
            <Button size="sm" onClick={() => navigate(`/leagues/${id}/draft`)}>
              Go to Draft
            </Button>
          )}
          {league.status === 'drafting' && (
            <Button size="sm" onClick={() => navigate(`/leagues/${id}/draft`)} className="animate-pulse">
              Draft Live
            </Button>
          )}
        </div>

        {/* Tab bar */}
        <div className="max-w-3xl mx-auto px-4">
          <div className="flex border-b border-transparent -mb-px">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="relative max-w-3xl mx-auto px-4 py-6">
        {tab === 'myteam' && <MyTeamTab leagueId={id!} league={league} />}
        {tab === 'matchup' && <MatchupTab leagueId={id!} league={league} />}
        {tab === 'standings' && <StandingsTab leagueId={id!} league={league} />}
        {tab === 'players' && <PlayersTab leagueId={id!} />}
        {tab === 'settings' && <SettingsTab leagueId={id!} league={league} />}
      </main>
    </div>
  );
}
