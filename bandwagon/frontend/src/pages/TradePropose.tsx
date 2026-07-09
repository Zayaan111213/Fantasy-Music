import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ArrowLeftRight, Check } from 'lucide-react';
import { api } from '../api/client';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Spinner } from '../components/ui/Spinner';
import { dropsNeededFor } from '../components/TradesSection';
import type { League, PlayerEntry, TradesResponse } from '../api/types';

// In-progress proposal survives navigating to an artist's stats page and back.
type TradeDraft = { teamId: string; give: string[]; receive: string[]; drops: string[] };

function draftKey(leagueId: string) {
  return `bw_trade_draft_${leagueId}`;
}

function loadDraft(leagueId: string): TradeDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(leagueId));
    return raw ? (JSON.parse(raw) as TradeDraft) : null;
  } catch {
    return null;
  }
}

function PlayerRow({ player, selected, onToggle, leagueId }: {
  player: PlayerEntry;
  selected: boolean;
  onToggle: () => void;
  leagueId: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors ${
        selected ? 'bg-indigo-500/20 border border-indigo-500/50' : 'hover:bg-white/5 border border-transparent'
      }`}
    >
      <Avatar src={player.imageUrl} name={player.name} size="sm" />
      <div className="flex-1 min-w-0">
        <Link
          to={`/artists/${player.id}?leagueId=${leagueId}`}
          onClick={(e) => e.stopPropagation()}
          className="block truncate text-sm text-white hover:text-indigo-400 transition-colors"
        >
          {player.name}
        </Link>
        <Badge genre={player.primaryGenre}>{player.primaryGenre}</Badge>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-mono font-semibold text-white">{(player.lastWeekPoints ?? 0).toFixed(1)}</div>
        <div className="text-[10px] text-gray-600">{(player.avgLast5Points ?? 0).toFixed(1)} avg</div>
      </div>
      <div className="w-4 shrink-0">{selected && <Check className="w-4 h-4 text-indigo-400" />}</div>
    </button>
  );
}

export function TradePropose() {
  const { id } = useParams<{ id: string }>();
  const leagueId = id!;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const initial = loadDraft(leagueId);
  const [targetTeamId, setTargetTeamId] = useState<string>(initial?.teamId ?? '');
  const [give, setGive] = useState<Set<string>>(new Set(initial?.give ?? []));
  const [receive, setReceive] = useState<Set<string>>(new Set(initial?.receive ?? []));
  const [drops, setDrops] = useState<Set<string>>(new Set(initial?.drops ?? []));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const { data: league } = useQuery({
    queryKey: ['league', leagueId],
    queryFn: () => api.get<League & { teams: { id: string; name: string; logoUrl: string | null }[] }>(`/leagues/${leagueId}`),
  });
  const { data: players } = useQuery({
    queryKey: ['players', leagueId, '', ''],
    queryFn: () => api.get<PlayerEntry[]>(`/leagues/${leagueId}/players`),
  });
  const { data: tradesMeta } = useQuery({
    queryKey: ['trades', leagueId],
    queryFn: () => api.get<TradesResponse>(`/leagues/${leagueId}/trades`),
  });

  const myTeamId = tradesMeta?.myTeamId;

  // Persist the draft as it changes
  useEffect(() => {
    sessionStorage.setItem(
      draftKey(leagueId),
      JSON.stringify({ teamId: targetTeamId, give: [...give], receive: [...receive], drops: [...drops] } satisfies TradeDraft),
    );
  }, [leagueId, targetTeamId, give, receive, drops]);

  // ?artistId= entry point (Players tab icon / artist profile Trade button)
  const artistParam = searchParams.get('artistId');
  useEffect(() => {
    if (!artistParam || !players || !myTeamId) return;
    const player = players.find((p) => p.id === artistParam);
    if (!player) {
      setNotice('That artist could not be found in this league.');
    } else if (!player.rosteredBy) {
      setNotice(`${player.name} is a free agent — claim them from the Players tab instead of trading.`);
    } else if (player.rosteredBy.id === myTeamId) {
      setGive((prev) => new Set(prev).add(player.id));
    } else {
      setTargetTeamId((prevTeam) => {
        if (prevTeam && prevTeam === player.rosteredBy!.id) {
          setReceive((prev) => new Set(prev).add(player.id));
          return prevTeam;
        }
        setReceive(new Set([player.id]));
        setDrops(new Set());
        return player.rosteredBy!.id;
      });
    }
    setSearchParams({}, { replace: true });
  }, [artistParam, players, myTeamId, setSearchParams]);

  // All hooks must run on every render — keep this above the loading return.
  const effectiveDrops = new Set([...drops].filter((d) => !give.has(d)));
  const proposeMutation = useMutation({
    mutationFn: () => api.post(`/leagues/${leagueId}/trades`, {
      toTeamId: targetTeamId,
      give: [...give],
      receive: [...receive],
      drops: [...effectiveDrops],
    }),
    onSuccess: () => {
      sessionStorage.removeItem(draftKey(leagueId));
      queryClient.invalidateQueries({ queryKey: ['trades', leagueId] });
      navigate(`/leagues/${leagueId}`);
    },
    onError: (err: Error) => setError(err.message),
  });

  if (!league || !players || !tradesMeta) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Spinner className="w-10 h-10" />
      </div>
    );
  }

  const myArtists = players.filter((p) => p.rosteredBy?.id === myTeamId);
  const theirArtists = players.filter((p) => p.rosteredBy?.id === targetTeamId);
  const otherTeams = league.teams.filter((t) => t.id !== myTeamId);

  const dropsNeeded = dropsNeededFor(myArtists.length, give.size, receive.size);
  const dropCandidates = myArtists.filter((p) => !give.has(p.id));

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id_: string, cap?: number) => {
    const next = new Set(set);
    if (next.has(id_)) next.delete(id_);
    else if (cap === undefined || next.size < cap) next.add(id_);
    setter(next);
  };

  const selectTeam = (teamId: string) => {
    if (teamId !== targetTeamId) {
      setTargetTeamId(teamId);
      setReceive(new Set());
      setDrops(new Set());
    }
  };

  const clearDraftAndLeave = () => {
    sessionStorage.removeItem(draftKey(leagueId));
    navigate(`/leagues/${leagueId}`);
  };

  const canSubmit = !tradesMeta.tradingClosed
    && targetTeamId !== ''
    && give.size > 0
    && receive.size > 0
    && effectiveDrops.size === dropsNeeded
    && !proposeMutation.isPending;

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/20 via-gray-950 to-purple-950/10 pointer-events-none" />

      <header className="relative border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate(`/leagues/${leagueId}`)} className="text-gray-400 hover:text-white transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <ArrowLeftRight className="w-4 h-4 text-indigo-400" />
          <h1 className="font-semibold text-white">Propose Trade</h1>
        </div>
      </header>

      <main className="relative max-w-3xl mx-auto px-4 py-6 space-y-4">
        {tradesMeta.tradingClosed && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-sm text-amber-400">
            {tradesMeta.tradingClosed}
          </div>
        )}
        {notice && (
          <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-gray-400">{notice}</div>
        )}

        <Card className="p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">Trade with</div>
          <div className="flex flex-wrap gap-2">
            {otherTeams.map((t) => (
              <button
                key={t.id}
                onClick={() => selectTeam(t.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  targetTeamId === t.id
                    ? 'bg-indigo-500/20 border-indigo-500/50 text-white'
                    : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                }`}
              >
                <Avatar src={t.logoUrl} name={t.name} size="sm" />
                <span className="truncate max-w-36">{t.name}</span>
                {targetTeamId === t.id && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
              </button>
            ))}
          </div>
        </Card>

        {targetTeamId && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">
                You send ({give.size})
              </div>
              <div className="space-y-1">
                {myArtists.map((p) => (
                  <PlayerRow key={p.id} player={p} leagueId={leagueId} selected={give.has(p.id)} onToggle={() => toggle(give, setGive, p.id)} />
                ))}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">
                You receive ({receive.size})
              </div>
              <div className="space-y-1">
                {theirArtists.map((p) => (
                  <PlayerRow key={p.id} player={p} leagueId={leagueId} selected={receive.has(p.id)} onToggle={() => toggle(receive, setReceive, p.id)} />
                ))}
              </div>
            </Card>
          </div>
        )}

        {dropsNeeded > 0 && (
          <Card className="p-4">
            <div className="text-[10px] text-amber-400 uppercase tracking-wider font-medium mb-2">
              You receive more than you send — drop {dropsNeeded} player{dropsNeeded === 1 ? '' : 's'} ({effectiveDrops.size}/{dropsNeeded} selected)
            </div>
            <div className="space-y-1">
              {dropCandidates.map((p) => (
                <PlayerRow key={p.id} player={p} leagueId={leagueId} selected={effectiveDrops.has(p.id)} onToggle={() => toggle(effectiveDrops, setDrops, p.id, dropsNeeded)} />
              ))}
            </div>
          </Card>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={clearDraftAndLeave}
            className="flex-1 px-3 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-gray-300 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            onClick={() => proposeMutation.mutate()}
            className="flex-1 px-3 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            {proposeMutation.isPending ? 'Proposing…' : 'Propose Trade'}
          </button>
        </div>
      </main>
    </div>
  );
}
