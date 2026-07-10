import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Music2, ChevronLeft, Trophy, Users, Settings, Swords, Search, ArrowUpDown, User, Pencil, X, Check, Lock, ChevronRight, ChevronDown, ChevronUp, ArrowLeftRight, Bell, UserPlus, AlarmClock, Mail, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { TradesSection } from '../components/TradesSection';
import type { ActivityFeed, ActivityItem, Bracket, BracketMatchup, League, LeagueMatchup, Matchup, StandingsEntry, PlayerEntry, RosterSpot, Team, TeamWithRoster, WaiversResponse } from '../api/types';

type Tab = 'myteam' | 'matchup' | 'standings' | 'players' | 'notifications' | 'settings';

const ALL_STARTER_SLOTS = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Other', 'Flex'];
const ALL_BENCH_SLOTS = ['Bench-1', 'Bench-2', 'Bench-3'];

type WeekPhase = 'pre_season' | 'adjustment' | 'scoring' | 'complete';

function getWeekPhase(league: League): WeekPhase {
  if (league.status === 'complete') return 'complete';
  if (league.status !== 'active') return 'pre_season';
  const dayPT = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' });
  if (dayPT === 'Monday') return 'adjustment';

  // Week 1 only: adjustment until the first Tuesday after the draft ends.
  // Compares YYYY-MM-DD strings (en-CA locale) for safe lexicographic date comparison.
  if (league.currentWeek === 1 && league.draftTime) {
    const draft = new Date(league.draftTime);
    const draftDow = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
      .indexOf(draft.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' }));
    const daysToTuesday = draftDow === 2 ? 7 : (2 - draftDow + 7) % 7;
    const firstTuesdayApprox = new Date(draft);
    firstTuesdayApprox.setDate(draft.getDate() + daysToTuesday);
    const todayPT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const firstTuesdayPT = firstTuesdayApprox.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    if (todayPT < firstTuesdayPT) return 'adjustment';
  }

  return 'scoring';
}

const REGULAR_SEASON_WEEKS = 10;
const PLAYOFF_FINAL_WEEK = 12;

const PLAYOFF_TAGS: Record<string, { label: string; className: string }> = {
  semifinal:             { label: 'Semifinal',         className: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
  championship:          { label: '🏆 Championship',   className: 'bg-amber-500/10 text-amber-300 border-amber-500/40' },
  third_place:           { label: '🥉 3rd Place Game', className: 'bg-orange-500/10 text-orange-300 border-orange-500/30' },
  consolation_semifinal: { label: 'Consolation',       className: 'bg-sky-500/10 text-sky-400 border-sky-500/30' },
  fifth_place:           { label: '5th Place Game',    className: 'bg-sky-500/10 text-sky-400 border-sky-500/30' },
  seventh_place:         { label: '7th Place Game',    className: 'bg-sky-500/10 text-sky-400 border-sky-500/30' },
};

function PlayoffTag({ matchupType }: { matchupType?: string }) {
  const tag = matchupType ? PLAYOFF_TAGS[matchupType] : undefined;
  if (!tag) return null;
  return (
    <span className={`inline-flex items-center text-xs font-semibold border rounded px-2 py-0.5 ${tag.className}`}>
      {tag.label}
    </span>
  );
}

function weekTitle(week: number): string {
  if (week === 11) return 'Week 11 · Semifinals';
  if (week === 12) return 'Week 12 · Championship Week';
  return `Week ${week}`;
}

const BRACKET_LINE = 'border-white/25';

function BracketGame({ m, showScores }: { m: BracketMatchup; showScores: boolean }) {
  const tag = m.week === PLAYOFF_FINAL_WEEK || m.matchupType === 'fifth_place' ? PLAYOFF_TAGS[m.matchupType] : undefined;
  const row = (team: BracketMatchup['homeTeam'], seed: number | null, score: number) => {
    const isWinner = m.isFinalized && m.winnerId === team.id;
    return (
      <div className="flex items-center gap-1.5 py-0.5 min-w-0">
        <span className="w-5 shrink-0 text-center text-[10px] font-mono rounded bg-white/10 text-gray-400">{seed ?? '–'}</span>
        <span className={`truncate text-sm ${isWinner ? 'text-green-400 font-semibold' : 'text-white'}`}>{team.name}</span>
        <span className="shrink-0 text-[10px] font-mono text-gray-500">{team.wins}-{team.losses}</span>
        {showScores && (
          <span className={`ml-auto shrink-0 font-mono text-xs ${isWinner ? 'text-green-400' : 'text-gray-400'}`}>{score.toFixed(1)}</span>
        )}
      </div>
    );
  };
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
      {tag && (
        <span className={`inline-flex items-center text-[10px] font-semibold border rounded px-1.5 py-0.5 mb-1 ${tag.className}`}>
          {tag.label}
        </span>
      )}
      {row(m.homeTeam, m.homeSeed, m.homeScore)}
      {row(m.awayTeam, m.awaySeed, m.awayScore)}
    </div>
  );
}

function BracketTbd({ matchupType, label }: { matchupType: string; label: string }) {
  const tag = PLAYOFF_TAGS[matchupType];
  return (
    <div className="bg-white/5 rounded-lg px-3 py-2 border border-dashed border-white/15">
      {tag && (
        <span className={`inline-flex items-center text-[10px] font-semibold border rounded px-1.5 py-0.5 mb-1 ${tag.className}`}>
          {tag.label}
        </span>
      )}
      <div className="text-xs text-gray-500 italic py-1">{label}</div>
    </div>
  );
}

// Two-round bracket row with classic connector lines: round-1 games on the
// left fork into the round-2 game on the right. With a single round-1 game
// the connector is a straight line. `tail` (championship only) draws the
// final line out to the winner slot.
function BracketPair({ games, final, tail }: { games: ReactNode[]; final: ReactNode; tail?: string | null }) {
  return (
    <div className="flex items-stretch">
      <div className="flex-1 min-w-0 flex flex-col justify-around gap-2">{games}</div>
      {games.length > 1 ? (
        <div className="w-4 shrink-0 flex flex-col" aria-hidden="true">
          <div className="flex-1" />
          <div className={`flex-1 border-t border-r ${BRACKET_LINE}`} />
          <div className={`flex-1 border-b border-r ${BRACKET_LINE}`} />
          <div className="flex-1" />
        </div>
      ) : (
        <div className={`w-4 shrink-0 self-center border-t ${BRACKET_LINE}`} aria-hidden="true" />
      )}
      <div className={`w-3 shrink-0 self-center border-t ${BRACKET_LINE}`} aria-hidden="true" />
      <div className="flex-1 min-w-0 flex flex-col justify-center">{final}</div>
      {tail !== undefined && (
        <div className="hidden sm:flex w-28 shrink-0 items-center min-w-0">
          <div className={`w-3 shrink-0 border-t ${BRACKET_LINE}`} aria-hidden="true" />
          <span className={`pl-1.5 text-xs truncate ${tail ? 'text-green-400 font-semibold' : 'text-gray-600 italic'}`}>
            {tail ? `🏆 ${tail}` : 'Winner'}
          </span>
        </div>
      )}
    </div>
  );
}

// Spacer-aligned row that sits under a BracketPair's round-2 column
// (used for the 3rd and 7th place games).
function BracketUnderFinal({ children, withTail }: { children: ReactNode; withTail?: boolean }) {
  return (
    <div className="flex mt-2">
      <div className="flex-1 min-w-0" />
      <div className="w-7 shrink-0" />
      <div className="flex-1 min-w-0">{children}</div>
      {withTail && <div className="hidden sm:block w-28 shrink-0" />}
    </div>
  );
}

function BracketCard({ bracket }: { bracket: Bracket }) {
  const ms = bracket.matchups;
  const bySeed = (a: BracketMatchup, b: BracketMatchup) => (a.homeSeed ?? 99) - (b.homeSeed ?? 99);
  const semis = ms.filter((m) => m.matchupType === 'semifinal').sort(bySeed);
  const consSemis = ms.filter((m) => m.matchupType === 'consolation_semifinal').sort(bySeed);
  const championship = ms.find((m) => m.matchupType === 'championship');
  const third = ms.find((m) => m.matchupType === 'third_place');
  const fifth = ms.find((m) => m.matchupType === 'fifth_place');
  const seventh = ms.find((m) => m.matchupType === 'seventh_place');
  // In 6-team leagues a single week-11 game decides 5th place outright
  const fifthInRound1 = fifth && fifth.week !== PLAYOFF_FINAL_WEEK ? fifth : undefined;
  const fifthInFinals = fifth && fifth.week === PLAYOFF_FINAL_WEEK ? fifth : undefined;
  const showScores = !bracket.projected;
  const hasConsolation = consSemis.length > 0 || fifthInRound1 != null;
  const champion = championship?.isFinalized && championship.winnerId
    ? (championship.winnerId === championship.homeTeamId ? championship.homeTeam.name : championship.awayTeam.name)
    : null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1">
        <Trophy className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Playoff Bracket</h3>
        {bracket.projected && (
          <span className="text-[10px] font-semibold uppercase tracking-wider bg-white/10 text-gray-400 border border-white/10 rounded px-1.5 py-0.5">
            Projected
          </span>
        )}
      </div>
      {bracket.projected && (
        <p className="text-xs text-gray-500 mb-3">If the season ended today</p>
      )}
      <div className={`flex mb-2 ${bracket.projected ? '' : 'mt-2'}`}>
        <div className="flex-1 min-w-0 text-[10px] text-gray-500 uppercase tracking-wider font-medium">Semifinals · Week 11</div>
        <div className="w-7 shrink-0" />
        <div className="flex-1 min-w-0 text-[10px] text-gray-500 uppercase tracking-wider font-medium">Championship Week · Week 12</div>
        <div className="hidden sm:block w-28 shrink-0" />
      </div>
      <BracketPair
        games={semis.map((m) => <BracketGame key={m.id} m={m} showScores={showScores} />)}
        final={championship
          ? <BracketGame m={championship} showScores={showScores} />
          : <BracketTbd matchupType="championship" label="Semifinal winners" />}
        tail={champion}
      />
      <BracketUnderFinal withTail>
        {third
          ? <BracketGame m={third} showScores={showScores} />
          : <BracketTbd matchupType="third_place" label="Semifinal losers" />}
      </BracketUnderFinal>
      {hasConsolation && (
        <div className="mt-4 pt-3 border-t border-white/10">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">Consolation Bracket</div>
          {fifthInRound1 ? (
            // 6-team league: a single week-11 game decides 5th place outright
            <div className="flex">
              <div className="flex-1 min-w-0"><BracketGame m={fifthInRound1} showScores={showScores} /></div>
              <div className="w-7 shrink-0" />
              <div className="flex-1 min-w-0" />
            </div>
          ) : (
            <>
              <BracketPair
                games={consSemis.map((m) => <BracketGame key={m.id} m={m} showScores={showScores} />)}
                final={fifthInFinals
                  ? <BracketGame m={fifthInFinals} showScores={showScores} />
                  : <BracketTbd
                      matchupType="fifth_place"
                      label={consSemis.length === 2 ? 'Consolation winners' : 'Seed 5 vs consolation winner'}
                    />}
              />
              {consSemis.length === 2 && (
                <BracketUnderFinal>
                  {seventh
                    ? <BracketGame m={seventh} showScores={showScores} />
                    : <BracketTbd matchupType="seventh_place" label="Consolation losers" />}
                </BracketUnderFinal>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function SlotLabel({ slot }: { slot: string }) {
  const colors: Record<string, string> = {
    'R&B/Hip-Hop': 'text-purple-400', 'Pop': 'text-pink-400', 'Rock & Alternative': 'text-orange-400',
    'Country': 'text-amber-400', 'Other': 'text-teal-400', 'Flex': 'text-indigo-400',
    'Bench-1': 'text-gray-500', 'Bench-2': 'text-gray-500', 'Bench-3': 'text-gray-500',
  };
  const short: Record<string, string> = {
    'R&B/Hip-Hop': 'Hip-Hop', 'Rock & Alternative': 'Rock/Alt',
  };
  const display = slot.startsWith('Bench') ? 'Bench' : (short[slot] ?? slot);
  return <span className={`text-xs font-semibold uppercase tracking-wider ${colors[slot] || 'text-gray-400'}`}>{display}</span>;
}

function RosterRow({ spot, onSwapSelect, selectedSlot, readOnly = false, compact = false, reverse = false, leagueId, prevScore }: {
  spot: RosterSpot;
  onSwapSelect?: (slot: string) => void;
  selectedSlot?: string | null;
  readOnly?: boolean;
  compact?: boolean;
  reverse?: boolean;
  leagueId?: string;
  prevScore?: number | null;
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
            <Link to={`/artists/${spot.artist.id}${leagueId ? `?leagueId=${leagueId}` : ''}`} onClick={(e) => e.stopPropagation()} className={`font-medium text-white hover:text-indigo-400 transition-colors truncate block ${compact ? 'text-xs' : 'text-sm'}`}>
              {spot.artist.name}
            </Link>
            {!compact && (spot.slot === 'Other' || spot.slot === 'Flex' || spot.slot.startsWith('Bench')) && (
              <Badge genre={spot.artist.primaryGenre} className="mt-0.5">{spot.artist.primaryGenre}</Badge>
            )}
          </div>
          <div className="text-right shrink-0">
            {prevScore != null ? (
              <div className={`font-bold ${compact ? 'text-sm' : 'text-base'} text-gray-500`}>
                {prevScore.toFixed(1)}
              </div>
            ) : (
              <div className={`font-bold ${compact ? 'text-sm' : 'text-base'} ${isBench ? 'text-gray-500' : 'text-white'}`}>
                {score ? score.totalPoints.toFixed(1) : '—'}
              </div>
            )}
            {!compact && <div className="text-xs text-gray-600">{prevScore != null ? 'prev' : 'pts'}</div>}
          </div>
        </>
      ) : (
        <>
          {compact && <Avatar src={null} name="?" size="sm" />}
          <div className={`flex-1 min-w-0 ${reverse ? 'text-right' : ''}`}>
            {compact && <SlotLabel slot={spot.slot} />}
            <span className={`block text-gray-600 italic ${compact ? 'text-xs' : 'text-sm'}`}>Empty slot</span>
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

function TeamRosterCard({ title, roster, reverse = false, leagueId, prevScoreMap }: { title: string; roster: RosterSpot[]; reverse?: boolean; leagueId?: string; prevScoreMap?: Record<string, number> }) {
  return (
    <Card className="p-3">
      <h3 className={`text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 truncate ${reverse ? 'text-right' : ''}`}>{title}</h3>
      <div className="space-y-1">
        {ALL_STARTER_SLOTS.map((slot) => {
          const spot = getRosterSpot(roster, slot);
          return <RosterRow key={slot} spot={spot} readOnly compact reverse={reverse} leagueId={leagueId} prevScore={prevScoreMap && spot.artistId ? prevScoreMap[spot.artistId] : undefined} />;
        })}
      </div>
      <div className={`text-xs font-semibold text-gray-500 uppercase tracking-wider mt-2 mb-1 ${reverse ? 'text-right' : ''}`}>Bench</div>
      <div className="space-y-1">
        {ALL_BENCH_SLOTS.map((slot) => {
          const spot = getRosterSpot(roster, slot);
          return <RosterRow key={slot} spot={spot} readOnly compact reverse={reverse} leagueId={leagueId} prevScore={prevScoreMap && spot.artistId ? prevScoreMap[spot.artistId] : undefined} />;
        })}
      </div>
    </Card>
  );
}

const MAX_LOGO_SIZE = 5 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function MyTeamTab({ leagueId, league, phase }: { leagueId: string; league: League; phase: WeekPhase }) {
  const queryClient = useQueryClient();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  // Roster browser: null = my own team, otherwise the league team being viewed
  const [viewTeamId, setViewTeamId] = useState<string | null>(null);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);

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

  const { data: allTeams } = useQuery({
    queryKey: ['tradeTargets', leagueId],
    queryFn: () => api.get<TeamWithRoster[]>(`/leagues/${leagueId}/teams-with-rosters`),
    enabled: league.status === 'active' || league.status === 'complete',
  });

  const swapMutation = useMutation({
    mutationFn: ({ slotA, slotB }: { slotA: string; slotB: string }) =>
      api.put(`/leagues/${leagueId}/roster/lineup`, { slotA, slotB }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['myTeam', leagueId] }),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Spinner className="w-8 h-8" /></div>;
  if (!myTeam) return (
    <div className="text-center py-12 text-gray-400">
      {(league.status === 'pending' || league.status === 'pre_draft') ? 'Season hasn\'t started yet. Draft a team first!' : 'No team found.'}
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

  const seasonOver = phase === 'complete';
  const isLocked = phase === 'scoring' || seasonOver;

  // Team name doubles as a roster browser: pick any league team to view its roster
  function TeamSwitcher({ currentName }: { currentName: string }) {
    return (
      <div className="relative">
        <button
          onClick={() => setTeamMenuOpen((o) => !o)}
          className="flex items-center gap-1 font-semibold text-white text-lg hover:text-indigo-300 transition-colors min-w-0"
        >
          <span className="truncate">{currentName}</span>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${teamMenuOpen ? 'rotate-180' : ''}`} />
        </button>
        {teamMenuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setTeamMenuOpen(false)} />
            <div className="absolute left-0 top-full mt-1 z-20 w-60 max-h-72 overflow-y-auto bg-gray-900 border border-white/10 rounded-lg shadow-2xl py-1">
              {(allTeams ?? []).map((t) => {
                const isMine = t.id === myTeam!.id;
                const active = (viewTeamId ?? myTeam!.id) === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setViewTeamId(isMine ? null : t.id); setTeamMenuOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                      active ? 'bg-indigo-500/20 text-indigo-300' : 'text-gray-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Avatar src={t.logoUrl} name={t.name} size="sm" />
                    <span className="truncate">{t.name}</span>
                    {isMine && <span className="ml-auto text-[10px] text-gray-500 shrink-0">You</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // Viewing another team's roster: read-only starters/bench, no edit affordances
  const viewedTeam = viewTeamId && viewTeamId !== myTeam.id ? allTeams?.find((t) => t.id === viewTeamId) : null;
  if (viewedTeam) {
    const viewedRoster: RosterSpot[] = viewedTeam.rosterSpots.map((rs) => ({
      id: `${viewedTeam.id}-${rs.slot}`,
      teamId: viewedTeam.id,
      artistId: rs.artist?.id ?? null,
      slot: rs.slot,
      artist: rs.artist
        ? ({ ...rs.artist, weeklyScores: rs.artist.weeklyScores ?? [] } as unknown as RosterSpot['artist'])
        : null,
    }));
    const spotOf = (slot: string) => getRosterSpot(viewedRoster, slot);
    return (
      <div className="space-y-4">
        {/* The Card's backdrop-blur creates a stacking context — lift it while
            the team menu is open so the dropdown isn't painted under siblings */}
        <Card className={`p-5 ${teamMenuOpen ? 'relative z-30' : ''}`}>
          <div className="flex items-center gap-3">
            <Avatar src={viewedTeam.logoUrl ?? undefined} name={viewedTeam.name} size="xl" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-500 mb-0.5">Week {league.currentWeek}</div>
              <TeamSwitcher currentName={viewedTeam.name} />
            </div>
          </div>
        </Card>

        <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-gray-400 flex items-center justify-between gap-2">
          <span>Viewing {viewedTeam.name}'s roster</span>
          <button onClick={() => setViewTeamId(null)} className="text-indigo-400 hover:text-white text-xs font-medium shrink-0">
            Back to my team
          </button>
        </div>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Starters</h3>
          <div className="space-y-1">
            {ALL_STARTER_SLOTS.map((slot) => (
              <RosterRow key={slot} spot={spotOf(slot)} readOnly leagueId={leagueId} />
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Bench</h3>
          <div className="space-y-1">
            {ALL_BENCH_SLOTS.map((slot) => (
              <RosterRow key={slot} spot={spotOf(slot)} readOnly leagueId={leagueId} />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  function handleSlotClick(slot: string) {
    if (isLocked) return;
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
      {/* Lift above sibling stacking contexts while the team menu is open */}
      <Card className={`p-5 ${teamMenuOpen ? 'relative z-30' : ''}`}>
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
              <TeamSwitcher currentName={myTeam.name} />
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

      {seasonOver ? (
        <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-gray-400 flex items-center gap-2">
          <Trophy className="w-4 h-4 shrink-0" />
          Season complete — lineups are final
        </div>
      ) : isLocked && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-sm text-amber-400 flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          Lineup locked until Monday
        </div>
      )}

      {!isLocked && selectedSlot && (
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
          {isLocked ? (
            <div className="flex items-center gap-1 text-xs text-amber-500">
              <Lock className="w-3 h-3" />
              Locked
            </div>
          ) : (
            <div className="flex items-center gap-1 text-xs text-gray-600">
              <ArrowUpDown className="w-3 h-3" />
              Tap two slots to swap
            </div>
          )}
        </div>
        <div className="space-y-1">
          {ALL_STARTER_SLOTS.map((slot) => (
            <RosterRow key={slot} spot={getSpot(slot)} onSwapSelect={isLocked ? undefined : handleSlotClick} selectedSlot={selectedSlot} readOnly={isLocked} leagueId={leagueId} />
          ))}
        </div>
      </Card>

      {/* Bench */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Bench</h3>
        <div className="space-y-1">
          {ALL_BENCH_SLOTS.map((slot) => (
            <RosterRow key={slot} spot={getSpot(slot)} onSwapSelect={isLocked ? undefined : handleSlotClick} selectedSlot={selectedSlot} readOnly={isLocked} leagueId={leagueId} />
          ))}
        </div>
      </Card>

      {league.status === 'active' && <WaiverClaimsCard leagueId={leagueId} />}

      <TradesSection leagueId={leagueId} league={league} />
    </div>
  );
}

// Every matchup in the league for one week — shown under the user's own
// matchup so any week's full slate (including games you're not in) is visible.
function LeagueMatchupsCard({ leagueId, week, myTeamId, upcoming = false }: {
  leagueId: string;
  week: number;
  myTeamId?: string;
  upcoming?: boolean;
}) {
  const { data } = useQuery({
    queryKey: ['leagueMatchups', leagueId, week],
    queryFn: () => api.get<LeagueMatchup[]>(`/leagues/${leagueId}/matchups?week=${week}`),
  });
  if (!data || data.length === 0) return null;

  return (
    <Card className="p-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
        <Swords className="w-4 h-4" />
        Around the League
      </h3>
      <div className="divide-y divide-white/5">
        {data.map((m) => {
          const homeWon = m.isFinalized && m.winnerId === m.homeTeamId;
          const awayWon = m.isFinalized && m.winnerId === m.awayTeamId;
          const mine = myTeamId != null && (m.homeTeamId === myTeamId || m.awayTeamId === myTeamId);
          return (
            <div key={m.id} className={`py-2.5 ${mine ? 'bg-indigo-500/5 -mx-2 px-2 rounded' : ''}`}>
              <div className="grid grid-cols-12 items-center gap-2">
                <div className="col-span-4 flex items-center gap-2 min-w-0">
                  <Avatar src={m.homeTeam.logoUrl} name={m.homeTeam.name} size="sm" />
                  <span className={`truncate text-sm ${homeWon ? 'text-green-400 font-semibold' : 'text-white'}`}>{m.homeTeam.name}</span>
                </div>
                <div className="col-span-4 flex flex-col items-center gap-0.5">
                  <div className="font-mono text-sm whitespace-nowrap">
                    {upcoming ? (
                      <span className="text-gray-600">— vs —</span>
                    ) : (
                      <>
                        <span className={homeWon ? 'text-green-400 font-semibold' : 'text-gray-300'}>{m.homeScore.toFixed(1)}</span>
                        <span className="text-gray-600 mx-1.5">–</span>
                        <span className={awayWon ? 'text-green-400 font-semibold' : 'text-gray-300'}>{m.awayScore.toFixed(1)}</span>
                      </>
                    )}
                  </div>
                  <PlayoffTag matchupType={m.matchupType} />
                </div>
                <div className="col-span-4 flex items-center gap-2 justify-end min-w-0">
                  <span className={`truncate text-sm text-right ${awayWon ? 'text-green-400 font-semibold' : 'text-white'}`}>{m.awayTeam.name}</span>
                  <Avatar src={m.awayTeam.logoUrl} name={m.awayTeam.name} size="sm" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function MatchupTab({ leagueId, league, phase }: { leagueId: string; league: League; phase: WeekPhase }) {
  const { user } = useAuth();
  const [viewWeek, setViewWeek] = useState(league.currentWeek);
  const [weekMenuOpen, setWeekMenuOpen] = useState(false);
  const [showResultPopup, setShowResultPopup] = useState(false);

  // After the season completes every week is history, including the finals week.
  const isCurrentWeek = viewWeek === league.currentWeek && phase !== 'complete';
  const isPastWeek = viewWeek < league.currentWeek || phase === 'complete';
  const isFutureWeek = viewWeek > league.currentWeek && phase !== 'complete';

  const { data: matchup, isLoading } = useQuery({
    queryKey: ['matchup', leagueId, 'week', viewWeek],
    queryFn: () => api.get<Matchup | null>(`/leagues/${leagueId}/matchups/week/${viewWeek}`),
    enabled: phase !== 'pre_season',
  });

  const { data: prevMatchup } = useQuery({
    queryKey: ['matchup', leagueId, 'previous'],
    queryFn: () => api.get<Matchup | null>(`/leagues/${leagueId}/matchups/previous`),
    enabled: isCurrentWeek && phase === 'adjustment' && league.currentWeek > 1,
  });

  useEffect(() => {
    if (!prevMatchup?.isFinalized || !prevMatchup?.winnerId || phase !== 'adjustment') return;
    const key = `bw_result_${leagueId}_w${prevMatchup.week}`;
    if (!localStorage.getItem(key)) setShowResultPopup(true);
  }, [prevMatchup?.isFinalized, prevMatchup?.winnerId, prevMatchup?.week, phase, leagueId]);

  // Keep viewWeek in sync if league advances
  useEffect(() => {
    setViewWeek(league.currentWeek);
  }, [league.currentWeek]);

  if (phase === 'pre_season') {
    return (
      <div className="text-center py-12 text-gray-400">
        Your matchup will appear here after the draft.
      </div>
    );
  }

  // Playoff weeks (11-12) only become navigable once the bracket exists.
  const totalWeeks = league.currentWeek > REGULAR_SEASON_WEEKS || league.status === 'complete'
    ? PLAYOFF_FINAL_WEEK
    : REGULAR_SEASON_WEEKS;

  function WeekNav() {
    return (
      <div className="relative flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
        <button
          onClick={() => setViewWeek((w) => Math.max(1, w - 1))}
          disabled={viewWeek <= 1}
          className="p-1 rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekMenuOpen((o) => !o)}
            className="flex items-center gap-1 text-sm font-semibold text-white hover:text-indigo-300 transition-colors"
          >
            {weekTitle(viewWeek)}
            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${weekMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {isCurrentWeek && (
            <span className="text-xs bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded px-1.5 py-0.5">Current</span>
          )}
          {isPastWeek && matchup?.isFinalized && (
            <span className="text-xs bg-gray-700/50 text-gray-400 rounded px-1.5 py-0.5">Final</span>
          )}
        </div>
        <button
          onClick={() => setViewWeek((w) => Math.min(totalWeeks, w + 1))}
          disabled={viewWeek >= totalWeeks}
          className="p-1 rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {weekMenuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setWeekMenuOpen(false)} />
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 w-56 max-h-64 overflow-y-auto bg-gray-900 border border-white/10 rounded-lg shadow-2xl py-1">
              {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((w) => (
                <button
                  key={w}
                  onClick={() => { setViewWeek(w); setWeekMenuOpen(false); }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors ${
                    w === viewWeek ? 'bg-indigo-500/20 text-indigo-300' : 'text-gray-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span>{weekTitle(w)}</span>
                  {w === league.currentWeek && phase !== 'complete' && (
                    <span className="text-[10px] text-indigo-400 border border-indigo-500/30 bg-indigo-500/10 rounded px-1 py-0.5">Current</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  if (isLoading) return (
    <div className="space-y-4">
      <WeekNav />
      <div className="flex justify-center py-12"><Spinner className="w-8 h-8" /></div>
    </div>
  );

  if (!matchup) {
    return (
      <div className="space-y-4">
        <WeekNav />
        <div className="text-center py-12 text-gray-400">
          {viewWeek > REGULAR_SEASON_WEEKS
            ? `You don't have a Week ${viewWeek} playoff game.`
            : isFutureWeek
              ? `Week ${viewWeek} matchup hasn't been played yet.`
              : 'No matchup found for this week.'}
        </div>
        <LeagueMatchupsCard leagueId={leagueId} week={viewWeek} upcoming={isFutureWeek} />
      </div>
    );
  }

  const isHome = matchup.homeTeam?.userId === user?.id;
  const myTeamData = isHome ? matchup.homeTeam : matchup.awayTeam;
  const oppTeamData = isHome ? matchup.awayTeam : matchup.homeTeam;
  const myScore = isHome ? matchup.homeScore : matchup.awayScore;
  const oppScore = isHome ? matchup.awayScore : matchup.homeScore;
  const myTeamId = isHome ? matchup.homeTeamId : matchup.awayTeamId;
  const iWon = matchup.isFinalized && matchup.winnerId === myTeamId;
  const iLost = matchup.isFinalized && matchup.winnerId != null && matchup.winnerId !== myTeamId;

  // Build map: artistId → prev week totalPoints (from both rosters in previous matchup)
  const prevScoreMap: Record<string, number> = {};
  if (prevMatchup) {
    for (const spot of [...(prevMatchup.homeTeam?.rosterSpots ?? []), ...(prevMatchup.awayTeam?.rosterSpots ?? [])]) {
      if (spot.artistId && spot.artist?.weeklyScores?.[0] != null) {
        prevScoreMap[spot.artistId] = spot.artist.weeklyScores[0].totalPoints;
      }
    }
  }
  const hasPrevScores = Object.keys(prevScoreMap).length > 0;

  // Previous week result info for popup
  const prevIsHome = prevMatchup?.homeTeam?.userId === user?.id;
  const prevMyTeamId = prevIsHome ? prevMatchup?.homeTeamId : prevMatchup?.awayTeamId;
  const wonPrev = prevMatchup?.winnerId === prevMyTeamId;
  const prevMyScore = prevIsHome ? (prevMatchup?.homeScore ?? 0) : (prevMatchup?.awayScore ?? 0);
  const prevOppScore = prevIsHome ? (prevMatchup?.awayScore ?? 0) : (prevMatchup?.homeScore ?? 0);
  const prevMyTeamName = (prevIsHome ? prevMatchup?.homeTeam?.name : prevMatchup?.awayTeam?.name) ?? 'Your Team';
  const prevOppTeamName = (prevIsHome ? prevMatchup?.awayTeam?.name : prevMatchup?.homeTeam?.name) ?? 'Opponent';

  function dismissPopup() {
    if (prevMatchup) localStorage.setItem(`bw_result_${leagueId}_w${prevMatchup.week}`, 'seen');
    setShowResultPopup(false);
  }

  // Past week — show final result
  if (isPastWeek) {
    return (
      <div className="space-y-4">
        <WeekNav />
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>Week {viewWeek} · Final</span>
              <PlayoffTag matchupType={matchup.matchupType} />
            </div>
            {iWon && <span className="text-xs font-semibold text-green-400 bg-green-400/10 rounded px-2 py-0.5">Win</span>}
            {iLost && <span className="text-xs font-semibold text-red-400 bg-red-400/10 rounded px-2 py-0.5">Loss</span>}
            {!iWon && !iLost && <span className="text-xs text-gray-500">Not finalized</span>}
          </div>
          <div className="flex items-center justify-center gap-6">
            <div className="text-center">
              <div className="font-semibold text-white mb-1">{myTeamData?.name ?? 'Your Team'}</div>
              <div className={`text-3xl font-bold ${iWon ? 'text-green-400' : 'text-white'}`}>{myScore.toFixed(1)}</div>
            </div>
            <div className="text-gray-600 text-lg font-light">vs</div>
            <div className="text-center">
              <div className="font-semibold text-white mb-1">{oppTeamData?.name ?? 'Opponent'}</div>
              <div className={`text-3xl font-bold ${iLost ? 'text-green-400' : 'text-white'}`}>{oppScore.toFixed(1)}</div>
            </div>
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-2">
          <TeamRosterCard title={myTeamData?.name ?? 'Your Team'} roster={myTeamData?.rosterSpots ?? []} leagueId={leagueId} />
          <TeamRosterCard title={oppTeamData?.name ?? 'Opponent'} roster={oppTeamData?.rosterSpots ?? []} reverse leagueId={leagueId} />
        </div>
        <LeagueMatchupsCard leagueId={leagueId} week={viewWeek} myTeamId={myTeamId} />
      </div>
    );
  }

  // Future week — show upcoming matchup (no scores yet)
  if (isFutureWeek) {
    return (
      <div className="space-y-4">
        <WeekNav />
        <Card className="p-5">
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mb-3">
            <span>Week {viewWeek} · Upcoming</span>
            <PlayoffTag matchupType={matchup.matchupType} />
          </div>
          <div className="flex items-center justify-center gap-6">
            <div className="text-center">
              <div className="font-semibold text-white mb-1">{myTeamData?.name ?? 'Your Team'}</div>
              <div className="text-3xl font-bold text-gray-600">—</div>
            </div>
            <div className="text-gray-600 text-lg font-light">vs</div>
            <div className="text-center">
              <div className="font-semibold text-white mb-1">{oppTeamData?.name ?? 'Opponent'}</div>
              <div className="text-3xl font-bold text-gray-600">—</div>
            </div>
          </div>
        </Card>
        <LeagueMatchupsCard leagueId={leagueId} week={viewWeek} myTeamId={myTeamId} upcoming />
      </div>
    );
  }

  // Current week — existing phase-based logic
  if (phase === 'adjustment') {
    return (
      <div className="space-y-4">
        {/* Win/loss result popup */}
        {showResultPopup && prevMatchup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
            <div className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-sm shadow-2xl p-6 text-center">
              <div className="text-5xl mb-3">{wonPrev ? '🏆' : '😤'}</div>
              <h2 className={`text-2xl font-bold mb-1 ${wonPrev ? 'text-green-400' : 'text-red-400'}`}>
                {wonPrev ? 'You Won!' : 'You Lost'}
              </h2>
              <p className="text-gray-500 text-sm mb-5">Week {prevMatchup.week} final result</p>
              <div className="flex items-center justify-center gap-8 mb-6">
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1 truncate max-w-[80px]">{prevMyTeamName}</div>
                  <div className={`text-2xl font-bold ${wonPrev ? 'text-green-400' : 'text-white'}`}>{prevMyScore.toFixed(1)}</div>
                </div>
                <div className="text-gray-600 text-sm">vs</div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1 truncate max-w-[80px]">{prevOppTeamName}</div>
                  <div className={`text-2xl font-bold ${!wonPrev ? 'text-green-400' : 'text-white'}`}>{prevOppScore.toFixed(1)}</div>
                </div>
              </div>
              <button
                onClick={dismissPopup}
                className="w-full px-4 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-medium transition-colors"
              >
                Set Lineup for Week {league.currentWeek}
              </button>
            </div>
          </div>
        )}

        <WeekNav />

        {/* Adjustment banner */}
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex items-center gap-2 text-sm text-green-400">
          <ArrowUpDown className="w-4 h-4 shrink-0" />
          Lineup open · adjust on My Team before Tuesday
        </div>

        {/* H2H header — scores are 0, week hasn't started */}
        <Card className="p-5">
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mb-3">
            <span>Week {league.currentWeek} · starts Tuesday</span>
            <PlayoffTag matchupType={matchup.matchupType} />
          </div>
          <div className="flex items-center justify-center gap-6">
            <div className="text-center">
              <div className="font-semibold text-white mb-1">{myTeamData?.name ?? 'Your Team'}</div>
              <div className="text-3xl font-bold text-gray-600">{myScore.toFixed(1)}</div>
            </div>
            <div className="text-gray-600 text-lg font-light">vs</div>
            <div className="text-center">
              <div className="font-semibold text-white mb-1">{oppTeamData?.name ?? 'Opponent'}</div>
              <div className="text-3xl font-bold text-gray-600">{oppScore.toFixed(1)}</div>
            </div>
          </div>
        </Card>

        {/* Rosters — show prev week scores in gray */}
        <div className="grid grid-cols-2 gap-2">
          <TeamRosterCard
            title={myTeamData?.name ?? 'Your Team'}
            roster={myTeamData?.rosterSpots ?? []}
            leagueId={leagueId}
            prevScoreMap={hasPrevScores ? prevScoreMap : undefined}
          />
          <TeamRosterCard
            title={oppTeamData?.name ?? 'Opponent'}
            roster={oppTeamData?.rosterSpots ?? []}
            reverse
            leagueId={leagueId}
            prevScoreMap={hasPrevScores ? prevScoreMap : undefined}
          />
        </div>
        {hasPrevScores && (
          <p className="text-xs text-center text-gray-600">Scores shown are from Week {league.currentWeek - 1}</p>
        )}
        <LeagueMatchupsCard leagueId={leagueId} week={league.currentWeek} myTeamId={myTeamId} />
      </div>
    );
  }

  // Scoring phase — live scores, lineup locked
  return (
    <div className="space-y-4">
      <WeekNav />
      <Card className="p-5">
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mb-1">
          <span>Week {league.currentWeek}</span>
          <PlayoffTag matchupType={matchup.matchupType} />
        </div>
        <div className="flex items-center justify-center gap-1.5 mb-3">
          <Lock className="w-3 h-3 text-amber-500" />
          <span className="text-xs text-amber-500">Lineup locked · updates daily</span>
        </div>
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
        <TeamRosterCard title={myTeamData?.name ?? 'Your Team'} roster={myTeamData?.rosterSpots ?? []} leagueId={leagueId} />
        <TeamRosterCard title={oppTeamData?.name ?? 'Opponent'} roster={oppTeamData?.rosterSpots ?? []} reverse leagueId={leagueId} />
      </div>
      <LeagueMatchupsCard leagueId={leagueId} week={league.currentWeek} myTeamId={myTeamId} />
    </div>
  );
}

function StandingsTab({ leagueId, league }: { leagueId: string; league: League }) {
  const { data, isLoading } = useQuery({
    queryKey: ['standings', leagueId],
    queryFn: () => api.get<StandingsEntry[]>(`/leagues/${leagueId}/standings`),
  });

  const { data: bracket } = useQuery({
    queryKey: ['bracket', leagueId],
    queryFn: () => api.get<Bracket | null>(`/leagues/${leagueId}/bracket`),
    enabled: league.status === 'active' || league.status === 'complete',
  });

  if (isLoading) return <div className="flex justify-center py-12"><Spinner className="w-8 h-8" /></div>;

  const playoffCutline = 4;
  const inPlayoffs = league.currentWeek > REGULAR_SEASON_WEEKS || league.status === 'complete';

  return (
    <div className="space-y-4">
    <Card>
      <div className="p-4 border-b border-white/10">
        <div className="grid grid-cols-12 text-xs text-gray-500 uppercase tracking-wider font-medium">
          <div className="col-span-1">#</div>
          <div className="col-span-4">Team</div>
          <div className="col-span-2 text-center">W-L</div>
          <div className="col-span-3 text-right">Pts For</div>
          <div className="col-span-2 text-right">Waiver</div>
        </div>
      </div>
      {inPlayoffs && (
        <div className="px-4 py-2 text-xs text-gray-500 border-b border-white/10">
          {league.status === 'complete'
            ? 'Final regular-season standings'
            : 'Regular-season record · playoffs in progress'}
        </div>
      )}
      {data?.map((entry, i) => (
        <div key={entry.teamId}>
          {i === playoffCutline && (
            <div className="px-4 py-1 bg-purple-500/10 text-center text-xs text-purple-400 border-y border-purple-500/20">
              {inPlayoffs ? '── Playoffs ──' : '── Playoff Line ──'}
            </div>
          )}
          <div className="grid grid-cols-12 items-center p-4 hover:bg-white/5 transition-colors">
            <div className="col-span-1 text-gray-500 font-mono text-sm">{entry.rank}</div>
            <div className="col-span-4 flex items-center gap-2">
              <Avatar src={entry.avatarUrl} name={entry.username ?? '?'} size="sm" />
              <div>
                <div className="text-sm font-medium text-white">{entry.teamName}</div>
                <div className="text-xs text-gray-500">{entry.username}</div>
              </div>
            </div>
            <div className="col-span-2 text-center text-sm font-semibold text-white">
              {entry.wins}-{entry.losses}
            </div>
            <div className="col-span-3 text-right text-sm text-gray-300 font-mono">
              {entry.pointsFor.toFixed(1)}
            </div>
            <div className="col-span-2 text-right text-sm text-gray-500 font-mono">
              {entry.waiverPriority}
            </div>
          </div>
        </div>
      ))}
    </Card>
    {bracket && <BracketCard bracket={bracket} />}
    </div>
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

const MAIN_GENRES_FA = new Set(['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country']);
function canFillSlot(genre: string, slot: string): boolean {
  if (slot.startsWith('Bench') || slot === 'Flex') return true;
  if (slot === 'Other') return !MAIN_GENRES_FA.has(genre);
  return genre === slot;
}

// Pending waiver claims with per-claim priority reordering. Shared by the
// My Team and Players tabs (same react-query key, so one fetch serves both).
function WaiverClaimsCard({ leagueId }: { leagueId: string }) {
  const queryClient = useQueryClient();
  const { data: waivers } = useQuery({
    queryKey: ['waivers', leagueId],
    queryFn: () => api.get<WaiversResponse>(`/leagues/${leagueId}/waivers`),
  });

  const cancelClaim = useMutation({
    mutationFn: (claimId: string) => api.post(`/leagues/${leagueId}/waivers/${claimId}/cancel`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waivers', leagueId] }),
  });

  const reorder = useMutation({
    mutationFn: (claimIds: string[]) => api.put(`/leagues/${leagueId}/waivers/order`, { claimIds }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waivers', leagueId] }),
  });

  const claims = waivers?.claims ?? [];
  if (claims.length === 0) return null;

  const busy = cancelClaim.isPending || reorder.isPending;

  function move(index: number, delta: number) {
    const ids = claims.map((c) => c.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    reorder.mutate(ids);
  }

  return (
    <Card>
      <div className="p-3 border-b border-white/10 flex items-center justify-between">
        <span className="text-sm font-semibold text-white">Pending waiver claims</span>
        <span className="text-xs text-gray-500">
          Waiver position #{waivers!.waiverPosition} · processes Sunday night
        </span>
      </div>
      <div className="divide-y divide-white/5">
        {claims.map((claim, i) => (
          <div key={claim.id} className="flex items-center gap-3 p-3">
            <span className="w-5 text-center text-xs text-gray-500 font-mono shrink-0">{i + 1}</span>
            <div className="flex flex-col shrink-0">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0 || busy}
                aria-label={`Move ${claim.artist.name} up`}
                className="p-0.5 rounded text-gray-500 hover:text-white disabled:opacity-20 transition-colors"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === claims.length - 1 || busy}
                aria-label={`Move ${claim.artist.name} down`}
                className="p-0.5 rounded text-gray-500 hover:text-white disabled:opacity-20 transition-colors"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            <Avatar src={claim.artist.imageUrl} name={claim.artist.name} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">{claim.artist.name}</div>
              <div className="text-xs text-gray-500 truncate">
                Drop: {claim.dropArtist.name} ({claim.dropSlot})
              </div>
            </div>
            <button
              onClick={() => cancelClaim.mutate(claim.id)}
              disabled={busy}
              className="shrink-0 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-40 text-gray-300 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PlayersTab({ leagueId, league, onProposeTrade }: {
  leagueId: string;
  league: League;
  onProposeTrade?: (teamId: string, artistId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('');
  const [freeAgentsOnly, setFreeAgentsOnly] = useState(false);
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'last', dir: 'desc' });
  const [claimArtist, setClaimArtist] = useState<PlayerEntry | null>(null);
  const [dropSlot, setDropSlot] = useState<string | null>(null);
  const [claimError, setClaimError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['players', leagueId, search, genre],
    queryFn: () => api.get<PlayerEntry[]>(`/leagues/${leagueId}/players?${new URLSearchParams({ q: search, genre }).toString()}`),
    placeholderData: (prev) => prev,
  });

  const { data: myTeam } = useQuery({
    queryKey: ['myTeam', leagueId],
    queryFn: () => api.get<Team & { rosterSpots: RosterSpot[] }>(`/leagues/${leagueId}/roster`),
  });

  const { data: waivers } = useQuery({
    queryKey: ['waivers', leagueId],
    queryFn: () => api.get<WaiversResponse>(`/leagues/${leagueId}/waivers`),
    enabled: league.status === 'active',
  });

  // Submitting queues a waiver claim — the roster doesn't change until the
  // claims resolve Sunday night, so only the waivers query needs refreshing.
  const claimMutation = useMutation({
    mutationFn: ({ artistId, dropSlot }: { artistId: string; dropSlot: string }) =>
      api.post(`/leagues/${leagueId}/roster/claim`, { artistId, dropSlot }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waivers', leagueId] });
      setClaimArtist(null);
      setDropSlot(null);
      setClaimError('');
    },
    onError: (err: Error) => setClaimError(err.message),
  });

  const pendingArtistIds = new Set((waivers?.claims ?? []).map((c) => c.artist.id));

  const genres = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Dance', 'Latin', 'K-Pop', 'Afrobeats', 'Other'];

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

  const filledEligibleSlots = claimArtist
    ? (myTeam?.rosterSpots ?? []).filter(
        (s) => s.artistId && canFillSlot(claimArtist.primaryGenre, s.slot)
      )
    : [];

  return (
    <div className="space-y-4">
      {/* Claim modal */}
      {claimArtist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div>
                <h2 className="font-semibold text-white">Claim {claimArtist.name}</h2>
                <p className="text-xs text-gray-400 mt-0.5">Select a player to drop · claims process Sunday night</p>
              </div>
              <button onClick={() => { setClaimArtist(null); setDropSlot(null); setClaimError(''); }} className="text-gray-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-2 max-h-80 overflow-y-auto">
              {filledEligibleSlots.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">No eligible slots to drop from</p>
              ) : (
                filledEligibleSlots.map((spot) => (
                  <button
                    key={spot.slot}
                    onClick={() => setDropSlot(spot.slot)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left ${
                      dropSlot === spot.slot
                        ? 'bg-red-500/20 border border-red-500/40'
                        : 'hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <Avatar src={spot.artist?.imageUrl ?? null} name={spot.artist?.name ?? '?'} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">{spot.artist?.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <SlotLabel slot={spot.slot} />
                        {spot.artist && <Badge genre={spot.artist.primaryGenre}>{spot.artist.primaryGenre}</Badge>}
                      </div>
                    </div>
                    {dropSlot === spot.slot && <Check className="w-4 h-4 text-red-400 shrink-0" />}
                  </button>
                ))
              )}
            </div>
            {claimError && <p className="text-xs text-red-400 px-4 pb-2">{claimError}</p>}
            <div className="flex gap-2 p-4 border-t border-white/10">
              <button
                onClick={() => { setClaimArtist(null); setDropSlot(null); setClaimError(''); }}
                className="flex-1 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-gray-300 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={!dropSlot || claimMutation.isPending}
                onClick={() => dropSlot && claimMutation.mutate({ artistId: claimArtist.id, dropSlot })}
                className="flex-1 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
              >
                {claimMutation.isPending ? 'Submitting…' : 'Submit Waiver Claim'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending waiver claims (shared card with reordering) */}
      {league.status === 'active' && <WaiverClaimsCard leagueId={leagueId} />}

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
                      <Link to={`/artists/${artist.id}?leagueId=${leagueId}`} className="text-sm font-medium text-white hover:text-indigo-400 transition-colors block truncate">
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
                  <div className="col-span-3 flex justify-end items-center gap-1.5 min-w-0">
                    {artist.rosteredBy ? (
                      <>
                        <span className="text-xs text-gray-500 truncate">@{artist.rosteredBy.name}</span>
                        {league.status === 'active' && artist.rosteredBy.id !== myTeam?.id && onProposeTrade && (
                          <button
                            onClick={() => onProposeTrade(artist.rosteredBy!.id, artist.id)}
                            title="Propose trade"
                            aria-label={`Propose trade for ${artist.name}`}
                            className="shrink-0 p-1 rounded-md bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20 transition-colors"
                          >
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    ) : league.status === 'active' ? (
                      pendingArtistIds.has(artist.id) ? (
                        <span className="px-2 py-1 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-medium">
                          Claimed
                        </span>
                      ) : (
                        <button
                          onClick={() => { setClaimArtist(artist); setDropSlot(null); setClaimError(''); }}
                          className="px-2 py-1 rounded-md bg-green-600/20 border border-green-600/30 text-green-400 text-xs font-medium hover:bg-green-600/30 transition-colors"
                        >
                          Claim
                        </button>
                      )
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

const CHART_POSITION_LABELS = ['#1', '#2–10', '#11–25', '#26–50', '#51–100'];
const DEFAULT_CHART_POSITION: [number, number, number, number, number] = [25, 18, 12, 8, 4];
const DEFAULT_CHART_MOVEMENT = { newEntryBonus: 10, maxGain: 15, maxDrop: 10 };
const GENRES = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Dance', 'Other'];
const DEFAULT_STREAMING: [number, number, number, number, number, number, number] = [40, 30, 20, 12, 6, 2, 0];
const STREAMING_TIER_LABELS: Record<string, string[]> = {
  'R&B/Hip-Hop':        ['50M+', '25–49M', '10–24M', '5–9M', '1–4M', '1K–999K', '0'],
  'Pop':                ['50M+', '25–49M', '10–24M', '5–9M', '1–4M', '1K–999K', '0'],
  'Rock & Alternative': ['20M+', '10–19M', '4–9M',   '2–3M', '500K–1.9M', '1K–499K', '0'],
  'Country':            ['15M+', '8–14M',  '3–7M',   '1.5–2M', '400K–1.4M', '1K–399K', '0'],
  'Dance':              ['10M+', '5–9M',   '2–4M',   '1–1.9M', '250K–999K', '1K–249K', '0'],
  'Other':              ['15M+', '7–14M',  '3–6M',   '1–2M', '250K–999K', '1K–249K', '0'],
};

function SettingsTab({ leagueId, league }: { leagueId: string; league: League }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isCommissioner = league.commissionerId === user?.id;
  const isSettingsLocked = league.status !== 'pending';
  const isDraftTimeLocked = league.status !== 'pending';
  const isScoringLocked = league.status !== 'pending' && league.status !== 'complete';

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
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState('');

  const [chartPosition, setChartPosition] = useState<[number, number, number, number, number]>(
    league.scoringConfig?.chartPosition ?? DEFAULT_CHART_POSITION
  );
  const [chartMovement, setChartMovement] = useState(
    league.scoringConfig?.chartMovement ?? DEFAULT_CHART_MOVEMENT
  );
  const [streaming, setStreaming] = useState<Record<string, [number, number, number, number, number, number, number]>>(
    league.scoringConfig?.streaming ?? Object.fromEntries(GENRES.map((g) => [g, [...DEFAULT_STREAMING] as [number, number, number, number, number, number, number]]))
  );
  const [activeGenre, setActiveGenre] = useState(GENRES[0]);
  const [scoringSaving, setScoringSaving] = useState(false);
  const [scoringSaved, setScoringSaved] = useState(false);
  const [scoringError, setScoringError] = useState('');

  const navigate = useNavigate();

  async function handleLeave() {
    setLeaving(true);
    setLeaveError('');
    try {
      await api.post(`/leagues/${leagueId}/leave`, {});
      queryClient.invalidateQueries({ queryKey: ['leagues'] });
      navigate('/home');
    } catch (err) {
      setLeaveError(err instanceof Error ? err.message : 'Failed to leave league');
      setLeaving(false);
    }
  }

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
    if (draftTime) {
      const minAllowed = new Date(Date.now() + 60 * 60_000);
      if (new Date(draftTime) < minAllowed) {
        setError('Draft time must be at least 1 hour from now');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      await api.put(`/leagues/${leagueId}`, { name, draftTime: draftTime ? new Date(draftTime).toISOString() : null });
      queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveScoring() {
    setScoringSaving(true);
    setScoringError('');
    try {
      await api.put(`/leagues/${leagueId}`, { scoringConfig: { chartPosition, chartMovement, streaming } });
      queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
      setScoringSaved(true);
      setTimeout(() => setScoringSaved(false), 2000);
    } catch (err) {
      setScoringError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setScoringSaving(false);
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
          {isSettingsLocked && <span className="text-xs text-yellow-500">Locked (season started)</span>}
        </div>

        {isCommissioner && !isSettingsLocked ? (
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
                min={new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 16)}
                disabled={isDraftTimeLocked}
                onChange={(e) => setDraftTime(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {isDraftTimeLocked
                ? <p className="text-xs text-gray-500">Draft time cannot be changed after the draft has started</p>
                : <p className="text-xs text-gray-500">Must be at least 1 hour from now</p>
              }
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
              <span className="text-white">{league.isPrivate ? 'Private' : 'Public'}</span>
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

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Scoring Settings</h3>
          {isScoringLocked && <span className="text-xs text-yellow-500">Locked (season in progress)</span>}
        </div>

        <div className="space-y-6">
          {/* Chart Position */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Chart Position</p>
            <div className="grid grid-cols-5 gap-2">
              {CHART_POSITION_LABELS.map((label, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500 text-center">{label}</label>
                  <input
                    type="number"
                    min={0}
                    value={chartPosition[i]}
                    onChange={(e) => {
                      const next = [...chartPosition] as typeof chartPosition;
                      next[i] = parseInt(e.target.value) || 0;
                      setChartPosition(next);
                    }}
                    disabled={!isCommissioner || isScoringLocked}
                    className="w-full text-center bg-white/10 border border-white/20 rounded-lg px-1 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Chart Movement */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Chart Movement</p>
            <div className="grid grid-cols-3 gap-3">
              {([
                { label: 'New Entry Bonus', key: 'newEntryBonus' },
                { label: 'Max Gain Cap', key: 'maxGain' },
                { label: 'Max Drop Floor', key: 'maxDrop' },
              ] as const).map(({ label, key }) => (
                <div key={key} className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">{label}</label>
                  <input
                    type="number"
                    min={0}
                    value={chartMovement[key]}
                    onChange={(e) => setChartMovement({ ...chartMovement, [key]: parseInt(e.target.value) || 0 })}
                    disabled={!isCommissioner || isScoringLocked}
                    className="w-full text-center bg-white/10 border border-white/20 rounded-lg px-1 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Streaming Tiers */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Streaming Tiers</p>
            <div className="flex gap-1 overflow-x-auto pb-1 mb-3">
              {GENRES.map((g) => (
                <button
                  key={g}
                  onClick={() => setActiveGenre(g)}
                  className={`shrink-0 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    activeGenre === g
                      ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {(STREAMING_TIER_LABELS[activeGenre] ?? []).map((label, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500 text-center leading-tight">{label}</label>
                  <input
                    type="number"
                    min={0}
                    value={streaming[activeGenre]?.[i] ?? 0}
                    onChange={(e) => {
                      const next = [...(streaming[activeGenre] ?? DEFAULT_STREAMING)] as [number, number, number, number, number, number, number];
                      next[i] = parseInt(e.target.value) || 0;
                      setStreaming({ ...streaming, [activeGenre]: next });
                    }}
                    disabled={!isCommissioner || isScoringLocked}
                    className="w-full text-center bg-white/10 border border-white/20 rounded-lg px-0.5 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {isCommissioner && !isScoringLocked && (
          <div className="mt-5 space-y-2">
            {scoringError && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{scoringError}</div>
            )}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setChartPosition(DEFAULT_CHART_POSITION);
                  setChartMovement(DEFAULT_CHART_MOVEMENT);
                  setStreaming(Object.fromEntries(GENRES.map((g) => [g, [...DEFAULT_STREAMING] as [number, number, number, number, number, number, number]])));
                }}
              >
                Reset to Defaults
              </Button>
              <Button onClick={handleSaveScoring} disabled={scoringSaving} className="flex-1">
                {scoringSaving ? 'Saving…' : scoringSaved ? 'Saved!' : 'Save Scoring'}
              </Button>
            </div>
          </div>
        )}
        {!isCommissioner && (
          <p className="text-xs text-gray-600 mt-4">Only the commissioner can edit scoring settings</p>
        )}
      </Card>

      {isCommissioner && league.status === 'pending' && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Draft</h3>
          {league.draftTime && (
            <p className="text-sm text-gray-400 mb-4">
              Scheduled for{' '}
              <span className="text-white font-medium">{new Date(league.draftTime).toLocaleString()}</span>
              . Will start automatically if you don't start it early.
            </p>
          )}
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

      {!isCommissioner && league.status === 'pending' && (
        <Card className="p-5 border-red-500/20">
          <h3 className="text-sm font-semibold text-red-400/70 uppercase tracking-wider mb-4">Leave League</h3>
          {!confirmLeave ? (
            <div>
              <p className="text-sm text-gray-400 mb-4">
                Remove yourself from this league. You will lose your team and draft position.
              </p>
              <Button variant="danger" className="w-full" onClick={() => setConfirmLeave(true)}>
                Leave League
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-red-300">Are you sure? You will need to rejoin to get back in.</p>
              {leaveError && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{leaveError}</div>
              )}
              <div className="flex gap-2">
                <Button variant="danger" className="flex-1" onClick={handleLeave} disabled={leaving}>
                  {leaving ? 'Leaving…' : 'Yes, leave it'}
                </Button>
                <Button variant="secondary" className="flex-1" onClick={() => setConfirmLeave(false)} disabled={leaving}>
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

const ACTIVITY_ICONS: Record<string, ReactNode> = {
  claim: <UserPlus className="w-4 h-4 text-emerald-400" />,
  waiver_won: <UserPlus className="w-4 h-4 text-emerald-400" />,
  waiver_result: <UserPlus className="w-4 h-4 text-indigo-400" />,
  member_joined: <UserPlus className="w-4 h-4 text-indigo-400" />,
  trade_proposed: <Mail className="w-4 h-4 text-indigo-400" />,
  trade_accepted: <ArrowLeftRight className="w-4 h-4 text-amber-400" />,
  trade_executed: <ArrowLeftRight className="w-4 h-4 text-emerald-400" />,
  trade_vetoed: <ArrowLeftRight className="w-4 h-4 text-red-400" />,
  trade_rejected: <ArrowLeftRight className="w-4 h-4 text-red-400" />,
  trade_cancelled: <ArrowLeftRight className="w-4 h-4 text-gray-400" />,
  trade_failed: <ArrowLeftRight className="w-4 h-4 text-red-400" />,
  week_result: <Trophy className="w-4 h-4 text-amber-400" />,
  playoffs_set: <Trophy className="w-4 h-4 text-indigo-400" />,
  season_complete: <Trophy className="w-4 h-4 text-amber-400" />,
  lineup_reminder: <AlarmClock className="w-4 h-4 text-indigo-400" />,
  draft_complete: <Sparkles className="w-4 h-4 text-indigo-400" />,
};

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function NotificationsTab({ leagueId }: { leagueId: string }) {
  const queryClient = useQueryClient();
  const { data: feed, isLoading } = useQuery({
    queryKey: ['activity', leagueId],
    queryFn: () => api.get<ActivityFeed>(`/leagues/${leagueId}/activity`),
  });

  const markSeen = useMutation({
    mutationFn: () => api.post(`/leagues/${leagueId}/notifications/seen`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['activity', leagueId] }),
  });

  // Clear the badge whenever unseen items are showing (covers items that
  // arrive via the poll while the tab is already open).
  const unseenCount = feed?.unseenCount ?? 0;
  const { mutate: markSeenMutate, isPending: markSeenPending } = markSeen;
  useEffect(() => {
    if (unseenCount > 0 && !markSeenPending) markSeenMutate();
  }, [unseenCount, markSeenPending, markSeenMutate]);

  if (isLoading) return <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>;

  const items = feed?.items ?? [];
  if (items.length === 0) {
    return (
      <Card className="p-10 flex flex-col items-center gap-3 text-center">
        <Bell className="w-8 h-8 text-gray-600" />
        <p className="text-gray-400 text-sm">Nothing yet — league activity will show up here.</p>
      </Card>
    );
  }

  return (
    <Card className="divide-y divide-white/5">
      {items.map((item: ActivityItem) => (
        <div
          key={`${item.kind}-${item.id}`}
          className={`flex items-start gap-3 px-4 py-3 ${
            item.kind === 'personal' ? 'bg-indigo-500/5 border-l-2 border-indigo-500' : ''
          }`}
        >
          <div className="mt-0.5 shrink-0">{ACTIVITY_ICONS[item.type] ?? <Bell className="w-4 h-4 text-gray-400" />}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-200">{item.message}</p>
            {item.kind === 'personal' && item.type === 'trade_proposed' && (
              <Link to={`/leagues/${leagueId}/trade`} className="text-xs text-indigo-400 hover:text-indigo-300">
                View offer →
              </Link>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {item.kind === 'personal' && <Badge className="text-[10px]">For you</Badge>}
            <span className="text-xs text-gray-500 whitespace-nowrap">{timeAgo(item.createdAt)}</span>
          </div>
        </div>
      ))}
    </Card>
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
    refetchInterval: (query) => { const d = query.state.data; return (!d || d.status === 'pending' || d.status === 'pre_draft') ? 5000 : false; },
  });

  // Shared with NotificationsTab via the query cache; polled so the unseen
  // badge appears without a page reload.
  const { data: activityFeed } = useQuery({
    queryKey: ['activity', id],
    queryFn: () => api.get<ActivityFeed>(`/leagues/${id}/activity`),
    refetchInterval: 45_000,
    enabled: !!id,
    retry: false,
  });
  const unseenCount = activityFeed?.unseenCount ?? 0;

  if (isLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><Spinner className="w-8 h-8" /></div>;
  if (!league) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">League not found</div>;

  const isCommissioner = league.commissionerId === user?.id;
  const phase = getWeekPhase(league);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'myteam', label: 'My Team', icon: <User className="w-4 h-4" /> },
    { id: 'matchup', label: 'Matchup', icon: <Swords className="w-4 h-4" /> },
    { id: 'standings', label: 'Standings', icon: <Trophy className="w-4 h-4" /> },
    { id: 'players', label: 'Players', icon: <Users className="w-4 h-4" /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" /> },
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
          {league.status === 'pre_draft' && (
            <Button size="sm" onClick={() => navigate(`/leagues/${id}/draft`)} className="animate-pulse">
              Draft Lobby
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
                {t.id === 'notifications' && unseenCount > 0 && (
                  <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-500 text-white text-[11px] font-semibold flex items-center justify-center">
                    {unseenCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="relative max-w-3xl mx-auto px-4 py-6">
        {tab === 'myteam' && <MyTeamTab leagueId={id!} league={league} phase={phase} />}
        {tab === 'matchup' && <MatchupTab leagueId={id!} league={league} phase={phase} />}
        {tab === 'standings' && <StandingsTab leagueId={id!} league={league} />}
        {tab === 'players' && (
          <PlayersTab
            leagueId={id!}
            league={league}
            onProposeTrade={(_teamId, artistId) => navigate(`/leagues/${id}/trade?artistId=${artistId}`)}
          />
        )}
        {tab === 'notifications' && <NotificationsTab leagueId={id!} />}
        {tab === 'settings' && <SettingsTab leagueId={id!} league={league} />}
      </main>
    </div>
  );
}
