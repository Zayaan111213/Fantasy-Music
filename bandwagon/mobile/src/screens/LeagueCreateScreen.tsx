import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Copy, Check } from 'lucide-react-native';
import { api } from '../api/client';
import { posthog } from '../lib/posthog';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Avatar } from '../components/ui/Avatar';
import { Header } from '../components/Header';
import { ShareInviteButton } from '../components/ShareInviteButton';
import { minDraftTime, pacificInputValueToUtcIso } from '../utils/draftTime';

type Step = 'form' | 'success';

// datetime-local's wall-clock digits are always interpreted as Pacific time
// (see utils/draftTime.ts) regardless of the picker's own timezone — so we
// read the native Date's *local* getters (what the user visually picked),
// not a UTC conversion, to build the same "YYYY-MM-DDTHH:mm" value string.
function dateToPacificInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Invite links open in a browser (or a future deep link once that's wired
// up) — bandwagoner.com is the production web app's verified domain.
const WEB_ORIGIN = 'https://bandwagoner.com';

export function LeagueCreateScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [teamCount, setTeamCount] = useState(8);
  const [isPrivate, setIsPrivate] = useState(true);
  const [draftTime, setDraftTime] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [copied, setCopied] = useState(false);
  const [teamSyncWarning, setTeamSyncWarning] = useState('');

  const defaultTeamName = user?.username ? `${user.username}'s Squad` : '';
  const [teamName, setTeamName] = useState(defaultTeamName);
  const [logoUri, setLogoUri] = useState<string | null>(null);

  async function pickLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [1, 1] });
    if (!result.canceled) setLogoUri(result.assets[0].uri);
  }

  async function handleCreate() {
    setError('');
    setTeamSyncWarning('');
    if (!draftTime) {
      setError('A draft date & time is required');
      return;
    }
    const draftTimeIso = pacificInputValueToUtcIso(dateToPacificInputValue(draftTime));
    if (new Date(draftTimeIso) < minDraftTime()) {
      setError('Draft time must be at least 1 hour from now (Pacific Time)');
      return;
    }
    setLoading(true);
    try {
      const league = await api.post<{ id: string; inviteCode: string }>('/leagues', {
        name,
        teamCount,
        isPrivate,
        draftTime: draftTimeIso,
      });
      setInviteCode(league.inviteCode);
      setLeagueId(league.id);

      if (teamName !== defaultTeamName || logoUri) {
        try {
          const formData = new FormData();
          if (teamName !== defaultTeamName) formData.append('name', teamName);
          if (logoUri) {
            const filename = logoUri.split('/').pop() ?? 'logo.jpg';
            const ext = filename.split('.').pop()?.toLowerCase();
            formData.append('logo', { uri: logoUri, name: filename, type: `image/${ext === 'jpg' ? 'jpeg' : ext}` } as unknown as Blob);
          }
          await api.put(`/leagues/${league.id}/team`, formData);
        } catch {
          setTeamSyncWarning("League created, but we couldn't save your team customization. You can set it from the My Team tab.");
        }
      }

      posthog.capture('league_created', { leagueId: league.id, teamCount, isPrivate });
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create league');
    } finally {
      setLoading(false);
    }
  }

  const inviteUrl = `${WEB_ORIGIN}/leagues/join/${inviteCode}`;

  async function copyInvite() {
    await Clipboard.setStringAsync(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (step === 'success') {
    return (
      <View className="flex-1 bg-gray-950 items-center justify-center px-4">
        <View className="w-full max-w-md items-center">
          <View className="w-16 h-16 rounded-2xl bg-green-500/20 border border-green-500/30 items-center justify-center mb-4">
            <Check color="#6FA595" size={32} />
          </View>
          <Text className="text-2xl font-bold text-white mb-1">League Created!</Text>
          <Text className="text-gray-400 mb-6">Share this link to invite your friends</Text>

          {teamSyncWarning !== '' && (
            <View className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 mb-4 w-full">
              <Text className="text-sm text-yellow-400">{teamSyncWarning}</Text>
            </View>
          )}

          <Card className="p-4 mb-4 w-full">
            <View className="flex-row items-center gap-2 bg-white/5 rounded-lg p-3 mb-3">
              <Text className="flex-1 text-sm text-gray-300" numberOfLines={1}>{inviteUrl}</Text>
              <Pressable onPress={copyInvite}>
                {copied ? <Check color="#D9A02C" size={16} /> : <Copy color="#D9A02C" size={16} />}
              </Pressable>
            </View>
            <ShareInviteButton leagueName={name} inviteUrl={inviteUrl} variant="primary" />
          </Card>

          <Button onPress={() => navigation.replace('LeagueHub', { leagueId })} size="lg" className="w-full">
            Go to League
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-gray-950">
      <Header title="Create a League" />
      <ScrollView contentContainerClassName="px-4 py-6">
        <Card className="p-6 gap-5">
          <Input label="League Name" placeholder="e.g. Chart Toppers 2026" value={name} onChangeText={setName} />

          <View className="flex-row items-center gap-3">
            <Avatar src={logoUri} name={teamName || '?'} size="lg" />
            <View className="flex-1">
              <Input label="Your Team Name" value={teamName} onChangeText={setTeamName} />
              <Pressable onPress={pickLogo} className="mt-1">
                <Text className="text-xs text-indigo-400">{logoUri ? 'Change logo' : 'Add a team logo (optional)'}</Text>
              </Pressable>
            </View>
          </View>

          <View className="gap-1">
            <Text className="text-sm font-medium text-gray-300">Number of Teams</Text>
            <View className="flex-row gap-2 flex-wrap">
              {[4, 6, 8, 10, 12].map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setTeamCount(n)}
                  className={`w-12 h-10 rounded-lg items-center justify-center ${teamCount === n ? 'bg-indigo-500' : 'bg-white/10'}`}
                >
                  <Text className={`text-sm font-medium ${teamCount === n ? 'text-gray-950' : 'text-gray-300'}`}>{n}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View className="gap-1">
            <Text className="text-sm font-medium text-gray-300">Privacy</Text>
            <View className="flex-row gap-2">
              {([true, false] as const).map((p) => (
                <Pressable
                  key={String(p)}
                  onPress={() => setIsPrivate(p)}
                  className={`flex-1 py-2 rounded-lg items-center ${isPrivate === p ? 'bg-indigo-500' : 'bg-white/10'}`}
                >
                  <Text className={`text-sm font-medium ${isPrivate === p ? 'text-gray-950' : 'text-gray-300'}`}>
                    {p ? '🔒 Private' : '🌐 Public'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text className="text-xs text-gray-500">{isPrivate ? 'Join by invite link only' : 'Anyone can join until full'}</Text>
          </View>

          <View className="gap-1">
            <Text className="text-sm font-medium text-gray-300">Draft Date & Time (Pacific Time)</Text>
            <Pressable onPress={() => setShowPicker(true)} className="bg-white/10 border border-white/20 rounded-lg px-3 py-2.5">
              <Text className="text-white">
                {draftTime ? dateToPacificInputValue(draftTime).replace('T', ' ') : 'Select date & time'}
              </Text>
            </Pressable>
            {showPicker && (
              <DateTimePicker
                value={draftTime ?? minDraftTime()}
                mode="datetime"
                minimumDate={minDraftTime()}
                onChange={(_, selected) => {
                  setShowPicker(false);
                  if (selected) setDraftTime(selected);
                }}
              />
            )}
            <Text className="text-xs text-gray-500">Must be at least 1 hour from now, Pacific Time</Text>
          </View>

          {error !== '' && (
            <View className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <Text className="text-sm text-red-400">{error}</Text>
            </View>
          )}

          <Button onPress={handleCreate} disabled={loading} size="lg">
            {loading ? 'Creating…' : 'Create League & Get Invite Link'}
          </Button>
        </Card>
      </ScrollView>
    </View>
  );
}
