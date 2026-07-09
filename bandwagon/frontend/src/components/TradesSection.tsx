import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Check, X } from 'lucide-react';
import { api } from '../api/client';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Avatar } from './ui/Avatar';
import type { League, TeamWithRoster, TradeArtist, TradesResponse, TradeView } from '../api/types';

// Drops required to keep a 9-slot roster legal after a trade (mirrors the
// backend's requiredDropCount).
function dropsNeededFor(filled: number, give: number, receive: number): number {
  return Math.max(0, filled - give + receive - 9);
}

const STATUS_CHIPS: Record<string, { label: string; className: string }> = {
  pending:   { label: 'Pending',   className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' },
  accepted:  { label: 'Accepted · executes Sunday night', className: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30' },
  executed:  { label: 'Executed',  className: 'bg-green-500/10 text-green-400 border-green-500/30' },
  rejected:  { label: 'Rejected',  className: 'bg-gray-700/40 text-gray-400 border-white/10' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-700/40 text-gray-400 border-white/10' },
  vetoed:    { label: 'Vetoed',    className: 'bg-red-500/10 text-red-400 border-red-500/30' },
  failed:    { label: 'Failed',    className: 'bg-red-500/10 text-red-400 border-red-500/30' },
};

function StatusChip({ status }: { status: string }) {
  const chip = STATUS_CHIPS[status] ?? { label: status, className: 'bg-white/10 text-gray-300 border-white/10' };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider border rounded px-1.5 py-0.5 ${chip.className}`}>
      {chip.label}
    </span>
  );
}

function ArtistRow({ artist, selected, onToggle }: { artist: TradeArtist; selected: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors ${
        selected ? 'bg-indigo-500/20 border border-indigo-500/50' : 'hover:bg-white/5 border border-transparent'
      }`}
    >
      <Avatar src={artist.imageUrl} name={artist.name} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">{artist.name}</div>
        <Badge genre={artist.primaryGenre}>{artist.primaryGenre}</Badge>
      </div>
      {selected && <Check className="w-4 h-4 text-indigo-400 shrink-0" />}
    </button>
  );
}

function ProposeTradeModal({ leagueId, myTeamId, initialProposal, onClose }: {
  leagueId: string;
  myTeamId: string;
  initialProposal?: { teamId: string; artistId: string } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [targetTeamId, setTargetTeamId] = useState<string>(initialProposal?.teamId ?? '');
  const [give, setGive] = useState<Set<string>>(new Set());
  const [receive, setReceive] = useState<Set<string>>(new Set(initialProposal ? [initialProposal.artistId] : []));
  const [drops, setDrops] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const { data: teams } = useQuery({
    queryKey: ['tradeTargets', leagueId],
    queryFn: () => api.get<TeamWithRoster[]>(`/leagues/${leagueId}/teams-with-rosters`),
  });

  const myTeam = teams?.find((t) => t.id === myTeamId);
  const targetTeam = teams?.find((t) => t.id === targetTeamId);
  const myArtists = (myTeam?.rosterSpots ?? []).filter((s) => s.artist).map((s) => s.artist!);
  const theirArtists = (targetTeam?.rosterSpots ?? []).filter((s) => s.artist).map((s) => s.artist!);

  const dropsNeeded = dropsNeededFor(myArtists.length, give.size, receive.size);
  const dropCandidates = myArtists.filter((a) => !give.has(a.id));

  // Trim drops that are no longer needed or now part of the give set
  useEffect(() => {
    setDrops((prev) => {
      const next = new Set([...prev].filter((id) => !give.has(id)));
      while (next.size > dropsNeeded) next.delete([...next][next.size - 1]);
      return next.size === prev.size && [...next].every((id) => prev.has(id)) ? prev : next;
    });
  }, [give, dropsNeeded]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  const proposeMutation = useMutation({
    mutationFn: () => api.post(`/leagues/${leagueId}/trades`, {
      toTeamId: targetTeamId,
      give: [...give],
      receive: [...receive],
      drops: [...drops],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades', leagueId] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const canSubmit = targetTeamId && give.size > 0 && receive.size > 0 && drops.size === dropsNeeded && !proposeMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div>
            <h2 className="font-semibold text-white">Propose Trade</h2>
            <p className="text-xs text-gray-400 mt-0.5">Pick a team, then select players on both sides</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          <select
            value={targetTeamId}
            onChange={(e) => { setTargetTeamId(e.target.value); setReceive(new Set()); }}
            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Choose a team to trade with…</option>
            {(teams ?? []).filter((t) => t.id !== myTeamId).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          {targetTeam && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">You send</div>
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {myArtists.map((a) => (
                    <ArtistRow key={a.id} artist={a} selected={give.has(a.id)} onToggle={() => toggle(give, setGive, a.id)} />
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">You receive from {targetTeam.name}</div>
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {theirArtists.map((a) => (
                    <ArtistRow key={a.id} artist={a} selected={receive.has(a.id)} onToggle={() => toggle(receive, setReceive, a.id)} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {dropsNeeded > 0 && (
            <div>
              <div className="text-[10px] text-amber-400 uppercase tracking-wider font-medium mb-1">
                You receive more than you send — drop {dropsNeeded} player{dropsNeeded === 1 ? '' : 's'} ({drops.size}/{dropsNeeded} selected)
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {dropCandidates.map((a) => (
                  <ArtistRow key={a.id} artist={a} selected={drops.has(a.id)} onToggle={() => toggle(drops, setDrops, a.id)} />
                ))}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-400 px-4 pb-2">{error}</p>}
        <div className="flex gap-2 p-4 border-t border-white/10">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-gray-300 text-sm font-medium transition-colors">
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            onClick={() => proposeMutation.mutate()}
            className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            {proposeMutation.isPending ? 'Proposing…' : 'Propose Trade'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AcceptTradeModal({ leagueId, trade, myTeamId, onClose }: {
  leagueId: string;
  trade: TradeView;
  myTeamId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [drops, setDrops] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const { data: teams } = useQuery({
    queryKey: ['tradeTargets', leagueId],
    queryFn: () => api.get<TeamWithRoster[]>(`/leagues/${leagueId}/teams-with-rosters`),
  });

  const myTeam = teams?.find((t) => t.id === myTeamId);
  const myArtists = (myTeam?.rosterSpots ?? []).filter((s) => s.artist).map((s) => s.artist!);
  const myOutgoing = trade.items.filter((i) => i.fromTeamId === myTeamId && i.toTeamId !== null);
  const myIncoming = trade.items.filter((i) => i.toTeamId === myTeamId);
  const dropsNeeded = dropsNeededFor(myArtists.length, myOutgoing.length, myIncoming.length);
  const outgoingIds = new Set(myOutgoing.map((i) => i.artistId));
  const dropCandidates = myArtists.filter((a) => !outgoingIds.has(a.id));

  const acceptMutation = useMutation({
    mutationFn: () => api.post(`/leagues/${leagueId}/trades/${trade.id}/accept`, { drops: [...drops] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades', leagueId] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div>
            <h2 className="font-semibold text-white">Accept trade from {trade.proposerTeam.name}?</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              You receive {myIncoming.map((i) => i.artist.name).join(', ')} for {myOutgoing.map((i) => i.artist.name).join(', ')}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 overflow-y-auto space-y-2">
          {dropsNeeded > 0 ? (
            <>
              <p className="text-xs text-amber-400">
                You receive more players than you send — select {dropsNeeded} player{dropsNeeded === 1 ? '' : 's'} to drop ({drops.size}/{dropsNeeded})
              </p>
              {dropCandidates.map((a) => (
                <ArtistRow
                  key={a.id}
                  artist={a}
                  selected={drops.has(a.id)}
                  onToggle={() => {
                    const next = new Set(drops);
                    if (next.has(a.id)) next.delete(a.id); else if (next.size < dropsNeeded) next.add(a.id);
                    setDrops(next);
                  }}
                />
              ))}
            </>
          ) : (
            <p className="text-xs text-gray-500">No drops needed. The trade executes at the end of the scoring week (Sunday night) unless the rest of the league unanimously vetoes it.</p>
          )}
        </div>

        {error && <p className="text-xs text-red-400 px-4 pb-2">{error}</p>}
        <div className="flex gap-2 p-4 border-t border-white/10">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-gray-300 text-sm font-medium transition-colors">
            Cancel
          </button>
          <button
            disabled={drops.size !== dropsNeeded || acceptMutation.isPending}
            onClick={() => acceptMutation.mutate()}
            className="flex-1 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            {acceptMutation.isPending ? 'Accepting…' : 'Accept Trade'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TradesSection({ leagueId, league, initialProposal, onProposalConsumed }: {
  leagueId: string;
  league: League;
  initialProposal?: { teamId: string; artistId: string } | null;
  onProposalConsumed?: () => void;
}) {
  const queryClient = useQueryClient();
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposalSeed, setProposalSeed] = useState<{ teamId: string; artistId: string } | null>(null);
  const [acceptTarget, setAcceptTarget] = useState<TradeView | null>(null);
  const [actionError, setActionError] = useState('');

  const { data } = useQuery({
    queryKey: ['trades', leagueId],
    queryFn: () => api.get<TradesResponse>(`/leagues/${leagueId}/trades`),
    enabled: league.status === 'active' || league.status === 'complete',
  });

  // A trade icon elsewhere (Players tab) pre-targets a proposal
  useEffect(() => {
    if (initialProposal) {
      setProposalSeed(initialProposal);
      setProposeOpen(true);
      onProposalConsumed?.();
    }
  }, [initialProposal, onProposalConsumed]);

  const actionMutation = useMutation({
    mutationFn: ({ tradeId, action }: { tradeId: string; action: 'reject' | 'cancel' | 'veto' }) =>
      api.post(`/leagues/${leagueId}/trades/${tradeId}/${action}`, {}),
    onSuccess: () => {
      setActionError('');
      queryClient.invalidateQueries({ queryKey: ['trades', leagueId] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  if (league.status !== 'active' && league.status !== 'complete') return null;
  if (!data) return null;

  const { myTeamId, vetoesNeeded, tradingClosed, trades } = data;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4" />
          Trades
        </h3>
        {!tradingClosed && (
          <button
            onClick={() => { setProposalSeed(null); setProposeOpen(true); }}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
          >
            Propose Trade
          </button>
        )}
      </div>
      <p className="text-xs text-gray-600 mb-3">
        {tradingClosed ?? 'Accepted trades execute Sunday night. The rest of the league can veto — unanimously — before then. Deadline: end of week 7.'}
      </p>

      {actionError && <p className="text-xs text-red-400 mb-2">{actionError}</p>}

      {trades.length === 0 ? (
        <p className="text-sm text-gray-600 italic">No trades yet.</p>
      ) : (
        <div className="space-y-3">
          {trades.map((trade) => {
            const isProposer = trade.proposerTeam.id === myTeamId;
            const isReceiver = trade.receiverTeam.id === myTeamId;
            const involved = isProposer || isReceiver;
            const toReceiver = trade.items.filter((i) => i.toTeamId === trade.receiverTeam.id);
            const toProposer = trade.items.filter((i) => i.toTeamId === trade.proposerTeam.id);
            const dropped = trade.items.filter((i) => i.toTeamId === null);
            return (
              <div key={trade.id} className="bg-white/5 border border-white/10 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-sm font-medium text-white truncate">
                    {trade.proposerTeam.name} <span className="text-gray-600">↔</span> {trade.receiverTeam.name}
                  </div>
                  <StatusChip status={trade.status} />
                </div>
                <div className="text-xs text-gray-400 space-y-0.5">
                  <div><span className="text-gray-500">{trade.proposerTeam.name} sends:</span> {toReceiver.map((i) => i.artist.name).join(', ') || '—'}</div>
                  <div><span className="text-gray-500">{trade.receiverTeam.name} sends:</span> {toProposer.map((i) => i.artist.name).join(', ') || '—'}</div>
                  {dropped.length > 0 && (
                    <div><span className="text-gray-500">Dropped to free agency:</span> {dropped.map((i) => i.artist.name).join(', ')}</div>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-2">
                  {trade.status === 'pending' && isReceiver && !tradingClosed && (
                    <>
                      <button
                        onClick={() => setAcceptTarget(trade)}
                        className="px-2.5 py-1 rounded-md bg-green-600/20 border border-green-600/30 text-green-400 text-xs font-medium hover:bg-green-600/30 transition-colors"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => actionMutation.mutate({ tradeId: trade.id, action: 'reject' })}
                        className="px-2.5 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {trade.status === 'pending' && isProposer && (
                    <button
                      onClick={() => actionMutation.mutate({ tradeId: trade.id, action: 'cancel' })}
                      className="px-2.5 py-1 rounded-md bg-white/10 border border-white/10 text-gray-300 text-xs font-medium hover:bg-white/20 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                  {trade.status === 'accepted' && (
                    <span className="text-xs text-gray-500">
                      {trade.vetoCount} of {vetoesNeeded} vetoes
                    </span>
                  )}
                  {trade.status === 'accepted' && !involved && (
                    trade.myVetoed ? (
                      <span className="text-xs text-red-400">You voted to veto</span>
                    ) : (
                      <button
                        onClick={() => actionMutation.mutate({ tradeId: trade.id, action: 'veto' })}
                        className="px-2.5 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
                      >
                        Veto
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {proposeOpen && (
        <ProposeTradeModal
          leagueId={leagueId}
          myTeamId={myTeamId}
          initialProposal={proposalSeed}
          onClose={() => { setProposeOpen(false); setProposalSeed(null); }}
        />
      )}
      {acceptTarget && (
        <AcceptTradeModal leagueId={leagueId} trade={acceptTarget} myTeamId={myTeamId} onClose={() => setAcceptTarget(null)} />
      )}
    </Card>
  );
}
