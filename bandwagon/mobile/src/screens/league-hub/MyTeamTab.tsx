import { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { ChevronDown, Pencil, Check, X, Trophy, Lock, ArrowUpDown } from 'lucide-react-native';
import { api } from '../../api/client';
import { posthog } from '../../lib/posthog';
import type { League, RosterSpot, Team, TeamWithRoster } from '@bandwagon/shared';
import { Card } from '../../components/ui/Card';
import { Avatar } from '../../components/ui/Avatar';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { RosterRow, getRosterSpot } from '../../components/RosterRow';
import { WaiverClaimsCard } from '../../components/WaiverClaimsCard';
import { TradesSection } from '../../components/TradesSection';
import { ALL_STARTER_SLOTS, ALL_BENCH_SLOTS } from '../../constants/roster';
import type { WeekPhase } from '../../utils/weekPhase';

export function MyTeamTab({ leagueId, league, phase }: { leagueId: string; league: League; phase: WeekPhase }) {
  const queryClient = useQueryClient();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [viewTeamId, setViewTeamId] = useState<string | null>(null);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLogoUri, setEditLogoUri] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

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
    onSuccess: (_, { slotA, slotB }) => {
      posthog.capture('lineup_updated', { leagueId, slotA, slotB });
      queryClient.invalidateQueries({ queryKey: ['myTeam', leagueId] });
    },
  });

  if (isLoading) return <View className="py-12 items-center"><Spinner size="large" /></View>;
  if (!myTeam) {
    return (
      <Text className="text-center py-12 text-gray-400">
        {(league.status === 'pending' || league.status === 'pre_draft') ? "Season hasn't started yet. Draft a team first!" : 'No team found.'}
      </Text>
    );
  }

  function startEditing() {
    setEditName(myTeam!.name);
    setEditLogoUri(null);
    setEditError('');
    setEditing(true);
  }

  async function pickLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [1, 1] });
    if (!result.canceled) setEditLogoUri(result.assets[0].uri);
  }

  async function handleSaveIdentity() {
    setEditSaving(true);
    setEditError('');
    try {
      const formData = new FormData();
      if (editName.trim()) formData.append('name', editName.trim());
      if (editLogoUri) {
        const filename = editLogoUri.split('/').pop() ?? 'logo.jpg';
        const ext = filename.split('.').pop()?.toLowerCase();
        formData.append('logo', { uri: editLogoUri, name: filename, type: `image/${ext === 'jpg' ? 'jpeg' : ext}` } as unknown as Blob);
      }
      await api.put(`/leagues/${leagueId}/team`, formData);
      await queryClient.invalidateQueries({ queryKey: ['myTeam', leagueId] });
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setEditSaving(false);
    }
  }

  const seasonOver = phase === 'complete';
  const isLocked = phase === 'scoring' || seasonOver;

  function TeamSwitcher({ currentName }: { currentName: string }) {
    return (
      <>
        <Pressable onPress={() => setTeamMenuOpen(true)} className="flex-row items-center gap-1">
          <Text className="font-semibold text-white text-lg" numberOfLines={1}>{currentName}</Text>
          <ChevronDown color="#A88F70" size={16} />
        </Pressable>
        <Modal transparent animationType="fade" visible={teamMenuOpen} onRequestClose={() => setTeamMenuOpen(false)}>
          <Pressable className="flex-1 items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => setTeamMenuOpen(false)}>
            <View className="w-full max-w-xs max-h-96 bg-gray-900 border border-white/10 rounded-lg py-1">
              <ScrollView>
                {(allTeams ?? []).map((t) => {
                  const isMine = t.id === myTeam!.id;
                  const active = (viewTeamId ?? myTeam!.id) === t.id;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => { setViewTeamId(isMine ? null : t.id); setTeamMenuOpen(false); }}
                      className={`flex-row items-center gap-2 px-3 py-2.5 ${active ? 'bg-indigo-500/20' : ''}`}
                    >
                      <Avatar src={t.logoUrl} name={t.name} size="sm" />
                      <Text className={`flex-1 ${active ? 'text-indigo-300' : 'text-gray-300'}`} numberOfLines={1}>{t.name}</Text>
                      {isMine && <Text className="text-[10px] text-gray-500">You</Text>}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
      </>
    );
  }

  const viewedTeam = viewTeamId && viewTeamId !== myTeam.id ? allTeams?.find((t) => t.id === viewTeamId) : null;
  if (viewedTeam) {
    const viewedRoster: RosterSpot[] = viewedTeam.rosterSpots.map((rs) => ({
      id: `${viewedTeam.id}-${rs.slot}`,
      teamId: viewedTeam.id,
      artistId: rs.artist?.id ?? null,
      slot: rs.slot,
      artist: rs.artist ? ({ ...rs.artist, weeklyScores: rs.artist.weeklyScores ?? [] } as unknown as RosterSpot['artist']) : null,
    }));
    const spotOf = (slot: string) => getRosterSpot(viewedRoster, slot);
    return (
      <View className="gap-4">
        <Card className="p-5">
          <View className="flex-row items-center gap-3">
            <Avatar src={viewedTeam.logoUrl ?? undefined} name={viewedTeam.name} size="xl" />
            <View className="flex-1 min-w-0">
              <Text className="text-xs text-gray-500 mb-0.5">Week {league.currentWeek}</Text>
              <TeamSwitcher currentName={viewedTeam.name} />
            </View>
          </View>
        </Card>

        <View className="bg-white/5 border border-white/10 rounded-lg p-3 flex-row items-center justify-between">
          <Text className="text-sm text-gray-400">Viewing {viewedTeam.name}'s roster</Text>
          <Pressable onPress={() => setViewTeamId(null)}><Text className="text-indigo-400 text-xs font-medium">Back to my team</Text></Pressable>
        </View>

        <Card className="p-4">
          <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Starters</Text>
          {ALL_STARTER_SLOTS.map((slot) => <RosterRow key={slot} spot={spotOf(slot)} readOnly leagueId={leagueId} />)}
        </Card>
        <Card className="p-4">
          <Text className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Bench</Text>
          {ALL_BENCH_SLOTS.map((slot) => <RosterRow key={slot} spot={spotOf(slot)} readOnly leagueId={leagueId} />)}
        </Card>
      </View>
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
  const getSpot = (slot: string) => getRosterSpot(myRoster, slot);
  const displayLogoUrl = editLogoUri ?? myTeam.logoUrl ?? undefined;

  return (
    <View className="gap-4">
      <Card className="p-5">
        {editing ? (
          <View className="gap-3">
            <View className="flex-row items-center gap-3">
              <Pressable onPress={pickLogo}>
                <Avatar src={displayLogoUrl} name={editName || '?'} size="xl" />
              </Pressable>
              <View className="flex-1 min-w-0">
                <Input label="Team Name" value={editName} onChangeText={setEditName} maxLength={30} />
              </View>
            </View>
            {editError !== '' && <Text className="text-xs text-red-400">{editError}</Text>}
            <View className="flex-row gap-2">
              <Pressable onPress={handleSaveIdentity} disabled={editSaving || !editName.trim()} className="flex-row items-center gap-1.5 bg-indigo-500 rounded-lg px-3 py-1.5">
                <Check color="#140D09" size={14} />
                <Text className="text-gray-950 text-sm font-medium">{editSaving ? 'Saving…' : 'Save'}</Text>
              </Pressable>
              <Pressable onPress={() => setEditing(false)} disabled={editSaving} className="flex-row items-center gap-1.5 bg-white/10 rounded-lg px-3 py-1.5">
                <X color="#D3BF9E" size={14} />
                <Text className="text-gray-300 text-sm font-medium">Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View className="flex-row items-center gap-3">
            <Avatar src={myTeam.logoUrl ?? undefined} name={myTeam.name} size="xl" />
            <View className="flex-1 min-w-0">
              <Text className="text-xs text-gray-500 mb-0.5">Week {league.currentWeek}</Text>
              <TeamSwitcher currentName={myTeam.name} />
            </View>
            <Pressable onPress={startEditing} className="p-2">
              <Pencil color="#7C6650" size={16} />
            </Pressable>
          </View>
        )}
      </Card>

      {seasonOver ? (
        <View className="bg-white/5 border border-white/10 rounded-lg p-3 flex-row items-center gap-2">
          <Trophy color="#D3BF9E" size={16} />
          <Text className="text-sm text-gray-400">Season complete. Lineups are final</Text>
        </View>
      ) : isLocked && (
        <View className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex-row items-center gap-2">
          <Lock color="#E07A3E" size={16} />
          <Text className="text-sm text-amber-400">Lineup locked until Monday</Text>
        </View>
      )}

      {!isLocked && selectedSlot && (
        <View className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-3 flex-row items-center justify-between">
          <Text className="text-sm text-indigo-300">Select a second slot to swap with {selectedSlot}</Text>
          <Pressable onPress={() => setSelectedSlot(null)}><Text className="text-indigo-400 text-xs">Cancel</Text></Pressable>
        </View>
      )}

      {swapMutation.isError && (
        <View className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <Text className="text-sm text-red-400">{(swapMutation.error as Error).message}</Text>
        </View>
      )}

      <Card className="p-4">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Starters</Text>
          {isLocked ? (
            <View className="flex-row items-center gap-1"><Lock color="#E07A3E" size={12} /><Text className="text-xs text-amber-500">Locked</Text></View>
          ) : (
            <View className="flex-row items-center gap-1"><ArrowUpDown color="#5F4936" size={12} /><Text className="text-xs text-gray-600">Tap two slots to swap</Text></View>
          )}
        </View>
        {ALL_STARTER_SLOTS.map((slot) => (
          <RosterRow key={slot} spot={getSpot(slot)} onSwapSelect={isLocked ? undefined : handleSlotClick} selectedSlot={selectedSlot} readOnly={isLocked} leagueId={leagueId} />
        ))}
      </Card>

      <Card className="p-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Bench</Text>
        {ALL_BENCH_SLOTS.map((slot) => (
          <RosterRow key={slot} spot={getSpot(slot)} onSwapSelect={isLocked ? undefined : handleSlotClick} selectedSlot={selectedSlot} readOnly={isLocked} leagueId={leagueId} />
        ))}
      </Card>

      {league.status === 'active' && <WaiverClaimsCard leagueId={leagueId} />}

      <TradesSection leagueId={leagueId} league={league} />
    </View>
  );
}
