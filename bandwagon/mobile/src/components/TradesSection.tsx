import { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Check, X } from 'lucide-react-native';
import { api } from '../api/client';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Avatar } from './ui/Avatar';
import { Spinner } from './ui/Spinner';
import type { League, TeamWithRoster, TradeArtist, TradeItemView, TradesResponse, TradeView } from '@bandwagon/shared';

export function dropsNeededFor(filled: number, give: number, receive: number): number {
  return Math.max(0, filled - give + receive - 9);
}

const STATUS_CHIPS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: '#EFA36B' },
  accepted: { label: 'Accepted · executes Sunday night', color: '#D9A02C' },
  executed: { label: 'Executed', color: '#8FBFAD' },
  rejected: { label: 'Rejected', color: '#A88F70' },
  cancelled: { label: 'Cancelled', color: '#A88F70' },
  vetoed: { label: 'Vetoed', color: '#D5714F' },
  failed: { label: 'Failed', color: '#D5714F' },
};

function StatusChip({ status }: { status: string }) {
  const chip = STATUS_CHIPS[status] ?? { label: status, color: '#D3BF9E' };
  return (
    <View className="self-start border rounded px-1.5 py-0.5" style={{ borderColor: `${chip.color}55` }}>
      <Text className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: chip.color }}>{chip.label}</Text>
    </View>
  );
}

function ArtistRow({ artist, selected, onToggle }: { artist: TradeArtist; selected: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} className={`flex-row items-center gap-2 p-2 rounded-lg ${selected ? 'bg-indigo-500/20 border border-indigo-500/50' : 'border border-transparent'}`}>
      <Avatar src={artist.imageUrl} name={artist.name} size="sm" />
      <View className="flex-1 min-w-0">
        <Text className="text-sm text-white" numberOfLines={1}>{artist.name}</Text>
        <Badge genre={artist.primaryGenre}>{artist.primaryGenre}</Badge>
      </View>
      {selected && <Check color="#D9A02C" size={16} />}
    </Pressable>
  );
}

function TradeDetailArtistRow({ leagueId, artist }: { leagueId: string; artist: TradeArtist }) {
  const navigation = useNavigation<any>();
  return (
    <Pressable onPress={() => navigation.navigate('ArtistDetail', { artistId: artist.id, leagueId })} className="flex-row items-center gap-2 py-1">
      <Avatar src={artist.imageUrl} name={artist.name} size="sm" />
      <View className="flex-1 min-w-0">
        <Text className="text-sm text-white" numberOfLines={1}>{artist.name}</Text>
        <Badge genre={artist.primaryGenre}>{artist.primaryGenre}</Badge>
      </View>
      <View className="items-end">
        <Text className="text-white font-semibold text-xs">{(artist.lastWeekPoints ?? 0).toFixed(1)} <Text className="text-gray-600 font-normal">last</Text></Text>
        <Text className="text-gray-400 text-xs">{(artist.avgLast5Points ?? 0).toFixed(1)} 5W avg</Text>
      </View>
    </Pressable>
  );
}

function TradeDetailSide({ leagueId, label, items }: { leagueId: string; label: string; items: TradeItemView[] }) {
  if (items.length === 0) return null;
  return (
    <View>
      <Text className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</Text>
      <View>{items.map((i) => <TradeDetailArtistRow key={i.id} leagueId={leagueId} artist={i.artist} />)}</View>
    </View>
  );
}

function TradeDetailModal({ leagueId, trade, onClose }: { leagueId: string; trade: TradeView; onClose: () => void }) {
  const toReceiver = trade.items.filter((i) => i.toTeamId === trade.receiverTeam.id);
  const toProposer = trade.items.filter((i) => i.toTeamId === trade.proposerTeam.id);
  const dropped = trade.items.filter((i) => i.toTeamId === null);
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
        <View className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-md max-h-[85%]">
          <View className="flex-row items-center justify-between p-4 border-b border-white/10">
            <View className="flex-1 min-w-0">
              <Text className="font-semibold text-white" numberOfLines={1}>{trade.proposerTeam.name} ↔ {trade.receiverTeam.name}</Text>
              <View className="mt-1"><StatusChip status={trade.status} /></View>
            </View>
            <Pressable onPress={onClose}><X color="#7C6650" size={20} /></Pressable>
          </View>
          <ScrollView className="p-4" contentContainerClassName="gap-4">
            <TradeDetailSide leagueId={leagueId} label={`${trade.proposerTeam.name} sends`} items={toReceiver} />
            <TradeDetailSide leagueId={leagueId} label={`${trade.receiverTeam.name} sends`} items={toProposer} />
            <TradeDetailSide leagueId={leagueId} label="Dropped to free agency" items={dropped} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function AcceptTradeModal({ leagueId, trade, myTeamId, onClose }: { leagueId: string; trade: TradeView; myTeamId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [drops, setDrops] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const { data: teams, isPending: rosterLoading, isError: rosterError, refetch } = useQuery({
    queryKey: ['tradeTargets', leagueId],
    queryFn: () => api.get<TeamWithRoster[]>(`/leagues/${leagueId}/teams-with-rosters`),
  });

  const myTeam = teams?.find((t) => t.id === myTeamId);
  const rosterReady = !rosterLoading && !rosterError && !!myTeam;
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
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <View className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-md max-h-[85%]">
          <View className="flex-row items-center justify-between p-4 border-b border-white/10">
            <View className="flex-1 min-w-0 mr-2">
              <Text className="font-semibold text-white">Accept trade from {trade.proposerTeam.name}?</Text>
              <Text className="text-xs text-gray-400 mt-0.5">
                You receive {myIncoming.map((i) => i.artist.name).join(', ')} for {myOutgoing.map((i) => i.artist.name).join(', ')}
              </Text>
            </View>
            <Pressable onPress={onClose}><X color="#7C6650" size={20} /></Pressable>
          </View>

          <ScrollView className="p-4" contentContainerClassName="gap-2">
            {!rosterReady ? (
              rosterError || (!rosterLoading && !myTeam) ? (
                <Pressable onPress={() => refetch()}>
                  <Text className="text-xs text-red-400">Couldn't load your roster. Tap to retry.</Text>
                </Pressable>
              ) : (
                <View className="py-4 items-center"><Spinner size="small" /></View>
              )
            ) : dropsNeeded > 0 ? (
              <>
                <Text className="text-xs text-amber-400 mb-1">
                  You receive more players than you send. Select {dropsNeeded} to drop ({drops.size}/{dropsNeeded})
                </Text>
                {dropCandidates.map((a) => (
                  <ArtistRow
                    key={a.id}
                    artist={a}
                    selected={drops.has(a.id)}
                    onToggle={() => {
                      const next = new Set(drops);
                      if (next.has(a.id)) next.delete(a.id);
                      else if (next.size < dropsNeeded) next.add(a.id);
                      setDrops(next);
                    }}
                  />
                ))}
              </>
            ) : (
              <Text className="text-xs text-gray-500">No drops needed. Executes Sunday night unless unanimously vetoed.</Text>
            )}
          </ScrollView>

          {error !== '' && <Text className="text-xs text-red-400 px-4 pb-2">{error}</Text>}
          <View className="flex-row gap-2 p-4 border-t border-white/10">
            <Pressable onPress={onClose} className="flex-1 bg-white/10 rounded-lg py-2.5 items-center">
              <Text className="text-gray-300 text-sm font-medium">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => acceptMutation.mutate()}
              disabled={!rosterReady || drops.size !== dropsNeeded || acceptMutation.isPending}
              className="flex-1 bg-green-600 rounded-lg py-2.5 items-center"
              style={{ opacity: !rosterReady || drops.size !== dropsNeeded || acceptMutation.isPending ? 0.4 : 1 }}
            >
              <Text className="text-white text-sm font-medium">{acceptMutation.isPending ? 'Accepting…' : 'Accept Trade'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function TradesSection({ leagueId, league }: { leagueId: string; league: League }) {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [acceptTarget, setAcceptTarget] = useState<TradeView | null>(null);
  const [detailTarget, setDetailTarget] = useState<TradeView | null>(null);
  const [actionError, setActionError] = useState('');

  const { data } = useQuery({
    queryKey: ['trades', leagueId],
    queryFn: () => api.get<TradesResponse>(`/leagues/${leagueId}/trades`),
    enabled: league.status === 'active' || league.status === 'complete',
  });

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
      <View className="flex-row items-center justify-between mb-1">
        <View className="flex-row items-center gap-2">
          <ArrowLeftRight color="#A88F70" size={16} />
          <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Trades</Text>
        </View>
        {!tradingClosed && (
          <Pressable onPress={() => navigation.navigate('TradePropose', { leagueId })} className="bg-indigo-600 rounded-lg px-3 py-1.5">
            <Text className="text-gray-950 text-xs font-medium">Propose Trade</Text>
          </Pressable>
        )}
      </View>
      <Text className="text-xs text-gray-600 mb-3">
        {tradingClosed ?? 'Accepted trades execute Sunday night. Unanimous veto kills them before then. Deadline: end of week 7.'}
      </Text>

      {actionError !== '' && <Text className="text-xs text-red-400 mb-2">{actionError}</Text>}

      {trades.length === 0 ? (
        <Text className="text-sm text-gray-600 italic">No trades yet.</Text>
      ) : (
        <View className="gap-3">
          {trades.map((trade) => {
            const isProposer = trade.proposerTeam.id === myTeamId;
            const isReceiver = trade.receiverTeam.id === myTeamId;
            const involved = isProposer || isReceiver;
            const toReceiver = trade.items.filter((i) => i.toTeamId === trade.receiverTeam.id);
            const toProposer = trade.items.filter((i) => i.toTeamId === trade.proposerTeam.id);
            const dropped = trade.items.filter((i) => i.toTeamId === null);
            return (
              <View key={trade.id} className="bg-white/5 border border-white/10 rounded-lg p-3">
                <Pressable onPress={() => setDetailTarget(trade)}>
                  <View className="flex-row items-center justify-between gap-2 mb-2">
                    <Text className="flex-1 text-sm font-medium text-white" numberOfLines={1}>{trade.proposerTeam.name} ↔ {trade.receiverTeam.name}</Text>
                    <StatusChip status={trade.status} />
                  </View>
                  <View className="gap-0.5">
                    <Text className="text-xs text-gray-400"><Text className="text-gray-500">{trade.proposerTeam.name} sends: </Text>{toReceiver.map((i) => i.artist.name).join(', ') || 'nothing'}</Text>
                    <Text className="text-xs text-gray-400"><Text className="text-gray-500">{trade.receiverTeam.name} sends: </Text>{toProposer.map((i) => i.artist.name).join(', ') || 'nothing'}</Text>
                    {dropped.length > 0 && (
                      <Text className="text-xs text-gray-400"><Text className="text-gray-500">Dropped: </Text>{dropped.map((i) => i.artist.name).join(', ')}</Text>
                    )}
                  </View>
                </Pressable>

                <View className="flex-row items-center gap-2 mt-2">
                  {trade.status === 'pending' && isReceiver && !tradingClosed && (
                    <>
                      <Pressable onPress={() => setAcceptTarget(trade)} className="bg-green-600/20 border border-green-600/30 rounded-md px-2.5 py-1">
                        <Text className="text-green-400 text-xs font-medium">Accept</Text>
                      </Pressable>
                      <Pressable onPress={() => actionMutation.mutate({ tradeId: trade.id, action: 'reject' })} className="bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-1">
                        <Text className="text-red-400 text-xs font-medium">Reject</Text>
                      </Pressable>
                    </>
                  )}
                  {trade.status === 'pending' && isProposer && (
                    <Pressable onPress={() => actionMutation.mutate({ tradeId: trade.id, action: 'cancel' })} className="bg-white/10 border border-white/10 rounded-md px-2.5 py-1">
                      <Text className="text-gray-300 text-xs font-medium">Cancel</Text>
                    </Pressable>
                  )}
                  {trade.status === 'accepted' && (
                    <Text className="text-xs text-gray-500">{trade.vetoCount} of {vetoesNeeded} vetoes</Text>
                  )}
                  {trade.status === 'accepted' && !involved && (
                    trade.myVetoed ? (
                      <Text className="text-xs text-red-400">You voted to veto</Text>
                    ) : (
                      <Pressable onPress={() => actionMutation.mutate({ tradeId: trade.id, action: 'veto' })} className="bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-1">
                        <Text className="text-red-400 text-xs font-medium">Veto</Text>
                      </Pressable>
                    )
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {acceptTarget && <AcceptTradeModal leagueId={leagueId} trade={acceptTarget} myTeamId={myTeamId} onClose={() => setAcceptTarget(null)} />}
      {detailTarget && <TradeDetailModal leagueId={leagueId} trade={detailTarget} onClose={() => setDetailTarget(null)} />}
    </Card>
  );
}
