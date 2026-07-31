import { useState } from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import DateTimePicker from '@react-native-community/datetimepicker';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import type { League, Team } from '@bandwagon/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { ShareInviteButton } from '../../components/ShareInviteButton';
import { minDraftTime, pacificInputValueToUtcIso, formatPacific } from '../../utils/draftTime';

function dateToPacificInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const WEB_ORIGIN = 'https://bandwagoner.com';

const CHART_POSITION_LABELS = ['#1', '#2-10', '#11-25', '#26-50', '#51-100'];
const DEFAULT_CHART_POSITION: [number, number, number, number, number] = [25, 18, 12, 8, 4];
const DEFAULT_CHART_MOVEMENT = { newEntryBonus: 10, maxGain: 15, maxDrop: 10 };
const GENRES = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Dance', 'Other'];
const DEFAULT_STREAMING: [number, number, number, number, number, number, number] = [40, 30, 20, 12, 6, 2, 0];

export function SettingsTab({ leagueId, league }: { leagueId: string; league: League & { teams?: Team[] } }) {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const isCommissioner = league.commissionerId === user?.id;
  const isSettingsLocked = league.status !== 'pending';
  const isScoringLocked = league.status !== 'pending' && league.status !== 'complete';

  const [name, setName] = useState(league.name);
  const [draftTime, setDraftTime] = useState<Date | null>(league.draftTime ? new Date(league.draftTime) : null);
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const [transferTarget, setTransferTarget] = useState('');
  const [transferMenuOpen, setTransferMenuOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [confirmKickTeamId, setConfirmKickTeamId] = useState<string | null>(null);
  const [kicking, setKicking] = useState(false);
  const [kickError, setKickError] = useState('');

  const [chartPosition, setChartPosition] = useState<[number, number, number, number, number]>(
    league.scoringConfig?.chartPosition ?? DEFAULT_CHART_POSITION,
  );
  const [chartMovement, setChartMovement] = useState(league.scoringConfig?.chartMovement ?? DEFAULT_CHART_MOVEMENT);
  const [streaming] = useState(
    league.scoringConfig?.streaming ?? Object.fromEntries(GENRES.map((g) => [g, [...DEFAULT_STREAMING]])),
  );
  const [scoringSaving, setScoringSaving] = useState(false);
  const [scoringSaved, setScoringSaved] = useState(false);
  const [scoringError, setScoringError] = useState('');

  async function handleLeave() {
    setLeaving(true);
    setLeaveError('');
    try {
      await api.post(`/leagues/${leagueId}/leave`, {});
      queryClient.invalidateQueries({ queryKey: ['leagues'] });
      navigation.navigate('Main', { screen: 'Home' });
    } catch (err) {
      setLeaveError(err instanceof Error ? err.message : 'Failed to leave league');
      setLeaving(false);
    }
  }

  async function handleTransfer() {
    if (!transferTarget) return;
    setTransferring(true);
    setTransferError('');
    try {
      await api.post(`/leagues/${leagueId}/transfer-commissioner`, { newCommissionerId: transferTarget });
      setTransferTarget('');
      queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setTransferring(false);
    }
  }

  async function handleKick(teamId: string) {
    setKicking(true);
    setKickError('');
    try {
      await api.post(`/leagues/${leagueId}/teams/${teamId}/kick`, {});
      setConfirmKickTeamId(null);
      queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    } catch (err) {
      setKickError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setKicking(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError('');
    try {
      await api.del(`/leagues/${leagueId}`);
      queryClient.invalidateQueries({ queryKey: ['leagues'] });
      navigation.navigate('Main', { screen: 'Home' });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
      setDeleting(false);
    }
  }

  async function handleSave() {
    const draftTimeIso = draftTime ? pacificInputValueToUtcIso(dateToPacificInputValue(draftTime)) : null;
    if (draftTimeIso && new Date(draftTimeIso) < minDraftTime()) {
      setError('Draft time must be at least 1 hour from now (Pacific Time)');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.put(`/leagues/${leagueId}`, { name, draftTime: draftTimeIso });
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

  async function handleStartDraft() {
    try {
      await api.post(`/leagues/${leagueId}/draft/start`, {});
      navigation.navigate('DraftRoom', { leagueId });
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to start draft');
    }
  }

  const inviteUrl = `${WEB_ORIGIN}/leagues/join/${league.inviteCode}`;
  const otherMembers = (league.teams ?? []).filter((t) => t.userId !== user?.id);

  return (
    <ScrollView contentContainerClassName="gap-4">
      <Card className="p-5">
        <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Invite</Text>
        <View className="flex-row items-center gap-2 bg-white/5 rounded-lg p-3 mb-2">
          <Text className="flex-1 text-sm text-gray-300" numberOfLines={1}>{inviteUrl}</Text>
          <Pressable onPress={() => Clipboard.setStringAsync(inviteUrl)}><Text className="text-indigo-400 text-xs">Copy</Text></Pressable>
        </View>
        <View className="flex-row items-center gap-2 mb-3">
          <Text className="text-xs text-gray-500">Code:</Text>
          <Text className="font-mono text-sm font-semibold text-white tracking-widest">{league.inviteCode}</Text>
          <Pressable onPress={() => Clipboard.setStringAsync(league.inviteCode)}><Text className="text-indigo-400 text-xs">Copy</Text></Pressable>
        </View>
        <ShareInviteButton leagueName={league.name} inviteUrl={inviteUrl} />
      </Card>

      <Card className="p-5">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider">League Settings</Text>
          {isSettingsLocked && <Text className="text-xs text-yellow-500">Locked (season started)</Text>}
        </View>

        {isCommissioner && !isSettingsLocked ? (
          <View className="gap-4">
            <View className="gap-1">
              <Text className="text-sm font-medium text-gray-300">League Name</Text>
              <TextInput value={name} onChangeText={setName} className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white" />
            </View>
            <View className="gap-1">
              <Text className="text-sm font-medium text-gray-300">Draft Date & Time (Pacific Time)</Text>
              <Pressable onPress={() => setShowPicker(true)} className="bg-white/10 border border-white/20 rounded-lg px-3 py-2.5">
                <Text className="text-white">{draftTime ? dateToPacificInputValue(draftTime).replace('T', ' ') : 'Select date & time'}</Text>
              </Pressable>
              {showPicker && (
                <DateTimePicker
                  value={draftTime ?? minDraftTime()}
                  mode="datetime"
                  minimumDate={minDraftTime()}
                  onChange={(_, selected) => { setShowPicker(false); if (selected) setDraftTime(selected); }}
                />
              )}
              <Text className="text-xs text-gray-500">Must be at least 1 hour from now, Pacific Time</Text>
            </View>
            <View className="gap-1">
              <Text className="text-sm font-medium text-gray-300">Team Count</Text>
              <Text className="text-white font-medium">{league.teamCount} teams</Text>
              <Text className="text-xs text-gray-600">Team count cannot be changed after creation</Text>
            </View>
            {error !== '' && <Text className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{error}</Text>}
            <Button onPress={handleSave} disabled={saving}>{saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}</Button>
          </View>
        ) : (
          <View className="gap-3">
            <View className="flex-row justify-between"><Text className="text-gray-500">Name</Text><Text className="text-white">{league.name}</Text></View>
            <View className="flex-row justify-between"><Text className="text-gray-500">Privacy</Text><Text className="text-white">{league.isPrivate ? 'Private' : 'Public'}</Text></View>
            <View className="flex-row justify-between"><Text className="text-gray-500">Teams</Text><Text className="text-white">{league.teamCount}</Text></View>
            {league.draftTime && (
              <View className="flex-row justify-between">
                <Text className="text-gray-500">Draft Time</Text>
                <Text className="text-white">{formatPacific(league.draftTime, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
              </View>
            )}
            {!isCommissioner && <Text className="text-xs text-gray-600">Only the commissioner can edit settings</Text>}
          </View>
        )}
      </Card>

      <Card className="p-5">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Scoring Settings</Text>
          {isScoringLocked && <Text className="text-xs text-yellow-500">Locked (season in progress)</Text>}
        </View>

        <View className="gap-6">
          <View>
            <Text className="text-xs font-medium text-gray-500 mb-2">Chart Position</Text>
            <View className="flex-row gap-2">
              {CHART_POSITION_LABELS.map((label, i) => (
                <View key={i} className="flex-1 gap-1">
                  <Text className="text-xs text-gray-500 text-center">{label}</Text>
                  <TextInput
                    value={String(chartPosition[i])}
                    onChangeText={(v) => {
                      const next = [...chartPosition] as typeof chartPosition;
                      next[i] = parseInt(v) || 0;
                      setChartPosition(next);
                    }}
                    keyboardType="number-pad"
                    editable={isCommissioner && !isScoringLocked}
                    className="text-center bg-white/10 border border-white/20 rounded-lg px-1 py-1.5 text-white text-sm"
                  />
                </View>
              ))}
            </View>
          </View>

          <View>
            <Text className="text-xs font-medium text-gray-500 mb-2">Chart Movement</Text>
            <View className="flex-row gap-3">
              {([
                { label: 'New Entry Bonus', key: 'newEntryBonus' as const },
                { label: 'Max Gain Cap', key: 'maxGain' as const },
                { label: 'Max Drop Floor', key: 'maxDrop' as const },
              ]).map(({ label, key }) => (
                <View key={key} className="flex-1 gap-1">
                  <Text className="text-xs text-gray-500">{label}</Text>
                  <TextInput
                    value={String(chartMovement[key])}
                    onChangeText={(v) => setChartMovement({ ...chartMovement, [key]: parseInt(v) || 0 })}
                    keyboardType="number-pad"
                    editable={isCommissioner && !isScoringLocked}
                    className="text-center bg-white/10 border border-white/20 rounded-lg px-1 py-1.5 text-white text-sm"
                  />
                </View>
              ))}
            </View>
          </View>
        </View>

        {isCommissioner && !isScoringLocked && (
          <View className="mt-5 gap-2">
            {scoringError !== '' && <Text className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{scoringError}</Text>}
            <View className="flex-row gap-2">
              <Button variant="secondary" size="sm" onPress={() => { setChartPosition(DEFAULT_CHART_POSITION); setChartMovement(DEFAULT_CHART_MOVEMENT); }}>
                Reset to Defaults
              </Button>
              <Button onPress={handleSaveScoring} disabled={scoringSaving} className="flex-1">
                {scoringSaving ? 'Saving…' : scoringSaved ? 'Saved!' : 'Save Scoring'}
              </Button>
            </View>
          </View>
        )}
        {!isCommissioner && <Text className="text-xs text-gray-600 mt-4">Only the commissioner can edit scoring settings</Text>}
      </Card>

      {isCommissioner && league.status === 'pending' && (
        <Card className="p-5">
          <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Draft</Text>
          {league.draftTime && (
            <Text className="text-sm text-gray-400 mb-4">
              Scheduled for <Text className="text-white font-medium">{formatPacific(league.draftTime, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>. Will start automatically if you don't start it early.
            </Text>
          )}
          <Button onPress={handleStartDraft}>Start Draft Now</Button>
        </Card>
      )}

      {isCommissioner && league.status === 'pending' && otherMembers.length > 0 && (
        <Card className="p-5">
          <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Members</Text>
          <Text className="text-sm text-gray-400 mb-4">Remove a member before the draft starts. They'll need a new invite to rejoin.</Text>
          <View className="gap-2">
            {otherMembers.map((t) => (
              <View key={t.id} className="flex-row items-center justify-between gap-3 bg-white/5 rounded-lg p-3">
                <View className="flex-row items-center gap-2 flex-1 min-w-0">
                  <Avatar src={t.user?.avatarUrl} name={t.user?.username ?? t.name} size="sm" />
                  <Text className="text-sm text-white" numberOfLines={1}>{t.user?.username ?? t.name}</Text>
                </View>
                {confirmKickTeamId === t.id ? (
                  <View className="flex-row items-center gap-2">
                    <Button variant="danger" size="sm" onPress={() => handleKick(t.id)} disabled={kicking}>{kicking ? 'Removing…' : 'Confirm'}</Button>
                    <Button variant="secondary" size="sm" onPress={() => setConfirmKickTeamId(null)} disabled={kicking}>Cancel</Button>
                  </View>
                ) : (
                  <Button variant="secondary" size="sm" onPress={() => { setConfirmKickTeamId(t.id); setKickError(''); }}>Remove</Button>
                )}
              </View>
            ))}
          </View>
          {kickError !== '' && <Text className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{kickError}</Text>}
        </Card>
      )}

      {isCommissioner && otherMembers.length > 0 && (
        <Card className="p-5">
          <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Transfer Commissionership</Text>
          <Text className="text-sm text-gray-400 mb-4">Hand control of the league to another member. You will keep your team but lose commissioner powers.</Text>
          <View className="flex-row gap-2">
            <Pressable onPress={() => setTransferMenuOpen(true)} className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2.5">
              <Text className="text-white text-sm">
                {transferTarget ? (otherMembers.find((t) => t.userId === transferTarget)?.user?.username ?? 'Selected') : 'Choose a member…'}
              </Text>
            </Pressable>
            <Button variant="secondary" onPress={handleTransfer} disabled={!transferTarget || transferring}>
              {transferring ? 'Transferring…' : 'Transfer'}
            </Button>
          </View>
          {transferError !== '' && <Text className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{transferError}</Text>}
          <Modal transparent animationType="fade" visible={transferMenuOpen} onRequestClose={() => setTransferMenuOpen(false)}>
            <Pressable className="flex-1 items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => setTransferMenuOpen(false)}>
              <View className="w-full max-w-xs bg-gray-900 border border-white/10 rounded-lg py-1">
                {otherMembers.map((t) => (
                  <Pressable key={t.userId} onPress={() => { setTransferTarget(t.userId); setTransferMenuOpen(false); }} className="px-3 py-2.5">
                    <Text className="text-gray-300">{t.user?.username ?? t.name}</Text>
                  </Pressable>
                ))}
              </View>
            </Pressable>
          </Modal>
        </Card>
      )}

      {isCommissioner && (
        <Card className="p-5" style={{ borderColor: 'rgba(213,113,79,0.2)' }}>
          <Text className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'rgba(213,113,79,0.7)' }}>Danger Zone</Text>
          {!confirmDelete ? (
            <View>
              <Text className="text-sm text-gray-400 mb-4">Permanently delete this league. All members will be notified the next time they log in.</Text>
              <Button variant="danger" onPress={() => setConfirmDelete(true)}>Delete League</Button>
            </View>
          ) : (
            <View className="gap-3">
              <Text className="text-sm text-red-300">Are you sure? This cannot be undone. All teams, rosters, and matchup history will be lost.</Text>
              {deleteError !== '' && <Text className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{deleteError}</Text>}
              <View className="flex-row gap-2">
                <Button variant="danger" className="flex-1" onPress={handleDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Yes, delete it'}</Button>
                <Button variant="secondary" className="flex-1" onPress={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button>
              </View>
            </View>
          )}
        </Card>
      )}

      {!isCommissioner && league.status === 'pending' && (
        <Card className="p-5" style={{ borderColor: 'rgba(213,113,79,0.2)' }}>
          <Text className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'rgba(213,113,79,0.7)' }}>Leave League</Text>
          {!confirmLeave ? (
            <View>
              <Text className="text-sm text-gray-400 mb-4">Remove yourself from this league. You will lose your team and draft position.</Text>
              <Button variant="danger" onPress={() => setConfirmLeave(true)}>Leave League</Button>
            </View>
          ) : (
            <View className="gap-3">
              <Text className="text-sm text-red-300">Are you sure? You will need to rejoin to get back in.</Text>
              {leaveError !== '' && <Text className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{leaveError}</Text>}
              <View className="flex-row gap-2">
                <Button variant="danger" className="flex-1" onPress={handleLeave} disabled={leaving}>{leaving ? 'Leaving…' : 'Yes, leave it'}</Button>
                <Button variant="secondary" className="flex-1" onPress={() => setConfirmLeave(false)} disabled={leaving}>Cancel</Button>
              </View>
            </View>
          )}
        </Card>
      )}
    </ScrollView>
  );
}
