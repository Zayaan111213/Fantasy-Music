import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Users } from 'lucide-react-native';
import { api } from '../api/client';
import { posthog } from '../lib/posthog';
import { useAuth } from '../context/AuthContext';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';
import { Header } from '../components/Header';

interface LeaguePreview {
  id: string;
  name: string;
  commissionerName: string;
  memberCount: number;
  teamCount: number;
  status: string;
}

interface PublicLeague {
  id: string;
  name: string;
  commissionerName: string;
  memberCount: number;
  teamCount: number;
  draftTime: string | null;
  inviteCode: string;
}

export function LeagueJoinScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const code: string | undefined = route.params?.code;
  const { user } = useAuth();

  const [manualCode, setManualCode] = useState('');
  const [resolvedCode, setResolvedCode] = useState('');
  const [preview, setPreview] = useState<LeaguePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [publicLeagues, setPublicLeagues] = useState<PublicLeague[]>([]);

  const [joinedLeagueId, setJoinedLeagueId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (code) loadPreview(code);
    api.get<PublicLeague[]>('/leagues/public').then(setPublicLeagues).catch(() => {});
  }, [code]);

  async function loadPreview(c: string) {
    setLoading(true);
    setError('');
    setResolvedCode(c);
    try {
      const data = await api.get<LeaguePreview>(`/leagues/invite/${c}`);
      setPreview(data);
    } catch {
      setError('Invalid or expired invite link');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    const c = code || resolvedCode || manualCode.trim().toUpperCase();
    if (!c) return;
    setJoining(true);
    setError('');
    try {
      const { league } = await api.post<{ league: { id: string } }>(`/leagues/join/${c}`, {});
      setTeamName(user?.username ? `${user.username}'s Squad` : '');
      setJoinedLeagueId(league.id);
      posthog.capture('league_joined', { leagueId: league.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join league');
    } finally {
      setJoining(false);
    }
  }

  async function pickLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [1, 1] });
    if (!result.canceled) setLogoUri(result.assets[0].uri);
  }

  async function handleSaveAndContinue() {
    if (!joinedLeagueId) return;
    setSaving(true);
    try {
      const formData = new FormData();
      if (teamName.trim()) formData.append('name', teamName.trim());
      if (logoUri) {
        const filename = logoUri.split('/').pop() ?? 'logo.jpg';
        const ext = filename.split('.').pop()?.toLowerCase();
        formData.append('logo', { uri: logoUri, name: filename, type: `image/${ext === 'jpg' ? 'jpeg' : ext}` } as unknown as Blob);
      }
      await api.put(`/leagues/${joinedLeagueId}/team`, formData);
    } catch {
      // Non-fatal — just navigate anyway
    } finally {
      navigation.replace('LeagueHub', { leagueId: joinedLeagueId });
    }
  }

  if (joinedLeagueId) {
    return (
      <View className="flex-1 bg-gray-950">
        <Header title="Set Up Your Team" />
        <ScrollView contentContainerClassName="px-4 py-8">
          <Card className="p-6">
            <Text className="text-gray-400 text-sm mb-5">
              You joined <Text className="text-white font-medium">{preview?.name}</Text>. Give your team a name and logo before you head in.
            </Text>
            <View className="flex-row items-center gap-3 mb-5">
              <Pressable onPress={pickLogo}>
                <Avatar src={logoUri} name={teamName || '?'} size="xl" />
              </Pressable>
              <View className="flex-1">
                <Input label="Team Name" value={teamName} onChangeText={setTeamName} maxLength={30} />
              </View>
            </View>
            <View className="gap-2">
              <Button onPress={handleSaveAndContinue} disabled={saving} size="lg">
                {saving ? 'Saving…' : 'Save & Enter League'}
              </Button>
              <Pressable onPress={() => navigation.replace('LeagueHub', { leagueId: joinedLeagueId })} className="items-center py-1">
                <Text className="text-sm text-gray-500">Skip for now</Text>
              </Pressable>
            </View>
          </Card>
        </ScrollView>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-gray-950">
      <Header title="Join a League" />
      <ScrollView contentContainerClassName="px-4 py-8 gap-6">
        {loading ? (
          <View className="py-16 items-center"><Spinner size="large" /></View>
        ) : preview ? (
          <Card className="p-6 items-center">
            <View className="w-14 h-14 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 items-center justify-center mb-4">
              <Users color="#D9A02C" size={28} />
            </View>
            <Text className="text-xl font-bold text-white mb-1">{preview.name}</Text>
            <Text className="text-gray-400 text-sm mb-4 text-center">
              Commissioner: {preview.commissionerName} · {preview.memberCount}/{preview.teamCount} teams joined
            </Text>
            {error !== '' && (
              <View className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4 w-full">
                <Text className="text-sm text-red-400">{error}</Text>
              </View>
            )}
            <Button onPress={handleJoin} disabled={joining} size="lg" className="w-full">
              {joining ? 'Joining…' : 'Join League'}
            </Button>
          </Card>
        ) : (
          <View className="gap-6">
            <Card className="p-6 gap-4">
              <Text className="text-lg font-semibold text-white">Enter an Invite Code</Text>
              <Input
                label="Invite Code"
                placeholder="e.g. ABC12345"
                autoCapitalize="characters"
                value={manualCode}
                onChangeText={(t) => setManualCode(t.toUpperCase())}
              />
              {error !== '' && (
                <View className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <Text className="text-sm text-red-400">{error}</Text>
                </View>
              )}
              <Button onPress={() => loadPreview(manualCode)} disabled={!manualCode.trim() || loading}>
                Look Up League
              </Button>
            </Card>

            {publicLeagues.length > 0 && (
              <View className="gap-3">
                <Text className="text-lg font-semibold text-white">Open Public Leagues</Text>
                {publicLeagues.map((league) => (
                  <Card key={league.id} className="p-4 flex-row items-center justify-between gap-4">
                    <View className="min-w-0 flex-1">
                      <Text className="text-white font-medium" numberOfLines={1}>{league.name}</Text>
                      <Text className="text-sm text-gray-400">
                        by {league.commissionerName} · {league.memberCount}/{league.teamCount} teams
                        {league.draftTime && ` · Draft ${new Date(league.draftTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })} PT`}
                      </Text>
                    </View>
                    <Button size="sm" onPress={() => loadPreview(league.inviteCode)}>
                      Join
                    </Button>
                  </Card>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
