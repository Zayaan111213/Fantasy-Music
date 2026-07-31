import { useState } from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, X, Check, Plus, ArrowLeftRight } from 'lucide-react-native';
import { api } from '../../api/client';
import type { League, PlayerEntry, RosterSpot, Team, WaiversResponse } from '@bandwagon/shared';
import { Card } from '../../components/ui/Card';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Spinner';
import { SlotPill, genreLabel } from '../../components/SlotPill';
import { WaiverClaimsCard } from '../../components/WaiverClaimsCard';
import { canFillSlot } from '../../constants/roster';
import { getWeekPhase } from '../../utils/weekPhase';

type SortField = 'name' | 'last' | 'avg';
type SortDir = 'desc' | 'asc';

function SortHeader({ label, field, sort, onSort, align = 'left' }: {
  label: string;
  field: SortField;
  sort: { field: SortField; dir: SortDir };
  onSort: (f: SortField) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.field === field;
  return (
    <Pressable onPress={() => onSort(field)} className={`flex-row items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
      <Text className={`text-xs uppercase tracking-wider font-medium ${active ? 'text-indigo-400' : 'text-gray-500'}`}>{label}</Text>
      <Text className="text-xs text-gray-500">{active ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}</Text>
    </Pressable>
  );
}

const GENRES = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Dance', 'Latin', 'K-Pop', 'Afrobeats', 'Other'];

export function PlayersTab({ leagueId, league, onProposeTrade }: {
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

  const freeAgency = getWeekPhase(league) === 'adjustment';
  const claimMutation = useMutation({
    mutationFn: ({ artistId, dropSlot }: { artistId: string; dropSlot: string }) =>
      api.post(`/leagues/${leagueId}/roster/claim`, { artistId, dropSlot }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waivers', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['players', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['myTeam', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['activity', leagueId] });
      setClaimArtist(null);
      setDropSlot(null);
      setClaimError('');
    },
    onError: (err: Error) => setClaimError(err.message),
  });

  const pendingArtistIds = new Set((waivers?.claims ?? []).map((c) => c.artist.id));

  function handleSort(field: SortField) {
    setSort((prev) => (prev.field === field ? { field, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { field, dir: 'desc' }));
  }

  const filtered = freeAgentsOnly ? (data ?? []).filter((a) => !a.rosteredBy) : (data ?? []);
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sort.field === 'name') cmp = a.name.localeCompare(b.name);
    else if (sort.field === 'last') cmp = (a.lastWeekPoints ?? 0) - (b.lastWeekPoints ?? 0);
    else cmp = (a.avgLast5Points ?? 0) - (b.avgLast5Points ?? 0);
    return sort.dir === 'desc' ? -cmp : cmp;
  });

  const eligibleSlots = claimArtist ? (myTeam?.rosterSpots ?? []).filter((s) => canFillSlot(claimArtist.primaryGenre, s.slot)) : [];

  return (
    <View className="gap-4">
      <Modal transparent animationType="fade" visible={!!claimArtist} onRequestClose={() => setClaimArtist(null)}>
        <View className="flex-1 items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-sm max-h-[85%]">
            <View className="flex-row items-center justify-between p-4 border-b border-white/10">
              <View className="flex-1 mr-2">
                <Text className="font-semibold text-white">Claim {claimArtist?.name}</Text>
                <Text className="text-xs text-gray-400 mt-0.5">{freeAgency ? 'Select a slot · adds are instant' : 'Select a slot · claims process Sunday night'}</Text>
              </View>
              <Pressable onPress={() => { setClaimArtist(null); setDropSlot(null); setClaimError(''); }}><X color="#7C6650" size={20} /></Pressable>
            </View>
            <ScrollView className="p-2" contentContainerClassName="gap-1">
              {eligibleSlots.length === 0 ? (
                <Text className="text-sm text-gray-500 text-center py-6">No eligible slots on your roster</Text>
              ) : (
                eligibleSlots.map((spot) => {
                  const empty = !spot.artistId;
                  const selected = dropSlot === spot.slot;
                  return (
                    <Pressable
                      key={spot.slot}
                      onPress={() => setDropSlot(spot.slot)}
                      className={`flex-row items-center gap-3 p-3 rounded-lg ${selected ? (empty ? 'bg-green-500/20 border border-green-500/40' : 'bg-red-500/20 border border-red-500/40') : 'border border-transparent'}`}
                    >
                      {empty ? (
                        <View className="w-8 h-8 rounded-full bg-white/5 border border-dashed border-white/20 items-center justify-center">
                          <Plus color="#7C6650" size={16} />
                        </View>
                      ) : (
                        <Avatar src={spot.artist?.imageUrl ?? null} name={spot.artist?.name ?? '?'} size="sm" />
                      )}
                      <View className="flex-1 min-w-0">
                        <Text className="text-sm font-medium text-white" numberOfLines={1}>{empty ? 'Empty slot' : spot.artist?.name}</Text>
                        <View className="flex-row items-center gap-1.5 mt-0.5">
                          <SlotPill slot={spot.slot} />
                          {spot.artist && <Badge genre={spot.artist.primaryGenre}>{genreLabel(spot.artist.primaryGenre)}</Badge>}
                        </View>
                      </View>
                      {selected && <Check color={empty ? '#8FBFAD' : '#D5714F'} size={16} />}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            {claimError !== '' && <Text className="text-xs text-red-400 px-4 pb-2">{claimError}</Text>}
            <View className="flex-row gap-2 p-4 border-t border-white/10">
              <Pressable onPress={() => { setClaimArtist(null); setDropSlot(null); setClaimError(''); }} className="flex-1 bg-white/10 rounded-lg py-2.5 items-center">
                <Text className="text-gray-300 text-sm font-medium">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => dropSlot && claimArtist && claimMutation.mutate({ artistId: claimArtist.id, dropSlot })}
                disabled={!dropSlot || claimMutation.isPending}
                className="flex-1 bg-green-600 rounded-lg py-2.5 items-center"
                style={{ opacity: !dropSlot || claimMutation.isPending ? 0.4 : 1 }}
              >
                <Text className="text-white text-sm font-medium">{claimMutation.isPending ? 'Submitting…' : freeAgency ? 'Add Free Agent' : 'Submit Claim'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {league.status === 'active' && <WaiverClaimsCard leagueId={leagueId} />}

      <View className="flex-row items-center gap-2 bg-white/10 border border-white/20 rounded-lg px-3">
        <Search color="#7C6650" size={16} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search artists…"
          placeholderTextColor="#7C6650"
          className="flex-1 text-white py-2.5"
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
        <Pressable onPress={() => setGenre('')} className={`px-3 py-1.5 rounded-lg ${genre === '' ? 'bg-indigo-500' : 'bg-white/10'}`}>
          <Text className={`text-xs font-medium ${genre === '' ? 'text-gray-950' : 'text-gray-300'}`}>All Genres</Text>
        </Pressable>
        {GENRES.map((g) => (
          <Pressable key={g} onPress={() => setGenre(g)} className={`px-3 py-1.5 rounded-lg ${genre === g ? 'bg-indigo-500' : 'bg-white/10'}`}>
            <Text className={`text-xs font-medium ${genre === g ? 'text-gray-950' : 'text-gray-300'}`}>{g}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setFreeAgentsOnly((v) => !v)}
          className={`px-3 py-1.5 rounded-lg border ${freeAgentsOnly ? 'bg-green-500/20 border-green-500/30' : 'bg-white/10 border-white/20'}`}
        >
          <Text className={`text-xs font-medium ${freeAgentsOnly ? 'text-green-400' : 'text-gray-300'}`}>Free Agents Only</Text>
        </Pressable>
      </ScrollView>

      {isLoading ? (
        <View className="py-8 items-center"><Spinner size="large" /></View>
      ) : (
        <Card>
          <View className="p-3 border-b border-white/10 flex-row items-center">
            <View className="flex-1"><SortHeader label="Artist" field="name" sort={sort} onSort={handleSort} /></View>
            <View className="w-14 items-end"><SortHeader label="Last" field="last" sort={sort} onSort={handleSort} align="right" /></View>
            <View className="w-14 items-end"><SortHeader label="5W" field="avg" sort={sort} onSort={handleSort} align="right" /></View>
            <View className="w-20" />
          </View>
          {sorted.map((artist) => (
            <View key={artist.id} className="p-3 border-b border-white/5 last:border-0 flex-row items-center gap-2">
              <View className="flex-1 flex-row items-center gap-2 min-w-0">
                <Avatar src={artist.imageUrl} name={artist.name} size="sm" />
                <View className="min-w-0">
                  <Text className="text-sm font-medium text-white" numberOfLines={1}>{artist.name}</Text>
                  <Badge genre={artist.primaryGenre} className="mt-0.5">{genreLabel(artist.primaryGenre)}</Badge>
                </View>
              </View>
              <Text className="w-14 text-right font-mono text-sm font-semibold text-white">{(artist.lastWeekPoints ?? 0).toFixed(1)}</Text>
              <Text className="w-14 text-right font-mono text-sm text-gray-300">{(artist.avgLast5Points ?? 0).toFixed(1)}</Text>
              <View className="w-20 items-end">
                {artist.rosteredBy ? (
                  <View className="flex-row items-center gap-1.5">
                    <Text className="text-xs text-gray-500" numberOfLines={1}>@{artist.rosteredBy.name}</Text>
                    {league.status === 'active' && artist.rosteredBy.id !== myTeam?.id && onProposeTrade && (
                      <Pressable onPress={() => onProposeTrade(artist.rosteredBy!.id, artist.id)} className="p-1 rounded-md bg-indigo-500/10 border border-indigo-500/30">
                        <ArrowLeftRight color="#D9A02C" size={14} />
                      </Pressable>
                    )}
                  </View>
                ) : league.status === 'active' ? (
                  pendingArtistIds.has(artist.id) ? (
                    <View className="px-2 py-1 rounded-md bg-amber-500/15 border border-amber-500/30">
                      <Text className="text-amber-400 text-xs font-medium">Claimed</Text>
                    </View>
                  ) : (
                    <Pressable onPress={() => { setClaimArtist(artist); setDropSlot(null); setClaimError(''); }} className="px-2 py-1 rounded-md bg-green-600/20 border border-green-600/30">
                      <Text className="text-green-400 text-xs font-medium">Claim</Text>
                    </Pressable>
                  )
                ) : (
                  <Text className="text-xs text-green-400 font-medium">Free Agent</Text>
                )}
              </View>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}
