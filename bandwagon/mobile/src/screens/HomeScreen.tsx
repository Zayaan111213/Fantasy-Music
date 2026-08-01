import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Plus, Users, Trophy, X, Music, Disc3 } from 'lucide-react-native';
import { api } from '../api/client';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { Header } from '../components/Header';
import { LeagueRow } from '../components/LeagueRow';
import { MoversCard } from '../components/ChartMovers';
import type { GlobalActivityItem, LeagueCard, MoversPayload, Notification } from '@bandwagon/shared';
import { timeAgo } from '../utils/timeAgo';

// Ported from frontend/src/pages/Home.tsx. The PWA install banner and
// HowItWorksModal are web-only concepts (native install happens via the App
// Store) and are dropped rather than ported.

const FIXED_SUMMARIES: Record<string, string> = {
  lineup_reminder: 'Set your lineup before Tuesday',
  waiver_result: 'Your waiver claim results are in',
  playoffs_set: 'Playoff bracket is set',
  season_complete: 'Season complete',
  draft_complete: 'Draft complete',
  league_renewed: 'Renewed for a new season',
  artist_split: 'An artist group was split up',
};

function summarize(item: GlobalActivityItem): string {
  const fixed = FIXED_SUMMARIES[item.type];
  if (fixed) return fixed;
  const clause = item.message.split(/(?::| — | - )/)[0].trim().replace(/\.$/, '');
  return clause.length > 64 ? `${clause.slice(0, 61)}…` : clause;
}

function activityGlyph(type: string): { glyph: string; color: string } {
  if (type.startsWith('trade')) return { glyph: '⇄', color: '#E8B23A' };
  if (type.startsWith('waiver') || type === 'claim') return { glyph: '＋', color: '#E07A3E' };
  if (type === 'member_joined') return { glyph: '＋', color: '#6FA595' };
  if (type === 'week_result' || type === 'season_complete' || type === 'playoffs_set') return { glyph: '♪', color: '#E8B23A' };
  return { glyph: '♪', color: '#A88F70' };
}

function ActivityCard({ items }: { items?: GlobalActivityItem[] }) {
  const navigation = useNavigation<any>();
  return (
    <Card className="p-5">
      <Text className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">Around Your Leagues</Text>
      {items && items.length > 0 ? (
        items.slice(0, 5).map((item) => {
          const { glyph, color } = activityGlyph(item.type);
          return (
            <Pressable
              key={item.id}
              onPress={() => navigation.navigate('LeagueHub', { leagueId: item.leagueId })}
              className="flex-row gap-3 py-2.5 border-b border-gray-900 last:border-0"
            >
              <View className="w-7 h-7 rounded-lg bg-gray-800 border border-gray-700 items-center justify-center">
                <Text style={{ color }} className="text-[13px]">{glyph}</Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[13px] text-gray-300 leading-snug" numberOfLines={1}>{summarize(item)}</Text>
                <Text className="text-[11px] text-gray-500 mt-0.5">{item.leagueName} · {timeAgo(item.createdAt)}</Text>
              </View>
            </Pressable>
          );
        })
      ) : (
        <Text className="text-sm text-gray-500 py-4 text-center">League activity will show up here.</Text>
      )}
    </Card>
  );
}

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();

  const { data: leagues, isLoading } = useQuery({
    queryKey: ['leagues'],
    queryFn: () => api.get<LeagueCard[]>('/leagues'),
  });

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<Notification[]>('/notifications'),
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/dismiss`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const { data: movers } = useQuery({
    queryKey: ['chartMovers'],
    queryFn: () => api.get<MoversPayload>('/charts/movers?limit=3'),
  });

  const { data: allActivity } = useQuery({
    queryKey: ['globalActivity'],
    queryFn: () => api.get<{ items: GlobalActivityItem[] }>('/notifications/activity'),
  });

  return (
    <View className="flex-1 bg-gray-950">
      <Header showWordmark showBack={false} />
      <ScrollView contentContainerClassName="px-4 py-6 gap-4 pb-10">
        {notifications && notifications.length > 0 && (
          <View className="gap-2">
            {notifications.map((n) => {
              const isDeletion = n.type === 'league_deleted' || n.type === 'kicked_from_league';
              return (
                <View
                  key={n.id}
                  className={`flex-row items-start gap-3 rounded-lg px-4 py-3 ${
                    isDeletion ? 'bg-red-500/10 border border-red-500/20' : 'bg-white/5 border border-white/10'
                  }`}
                >
                  <Text className={`flex-1 text-sm ${isDeletion ? 'text-red-300' : 'text-gray-300'}`}>{n.message}</Text>
                  <Pressable onPress={() => dismissMutation.mutate(n.id)}>
                    <X color={isDeletion ? '#D5714F' : '#7C6650'} size={16} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-2xl font-bold text-white">Your Leagues</Text>
            <Text className="text-gray-400 text-sm mt-0.5">Manage your fantasy music rosters</Text>
          </View>
        </View>

        <View className="flex-row gap-2">
          <Button variant="secondary" size="sm" className="flex-1" onPress={() => navigation.navigate('LeagueJoin')}>
            <Users color="#F3E7CE" size={16} /> Join a League
          </Button>
          <Button size="sm" className="flex-1" onPress={() => navigation.navigate('LeagueCreate')}>
            <Plus color="#140D09" size={16} /> Create a League
          </Button>
        </View>

        {isLoading ? (
          <View className="py-20 items-center">
            <Spinner size="large" />
          </View>
        ) : leagues && leagues.length > 0 ? (
          <View className="gap-4">
            {leagues.map((league) => <LeagueRow key={league.id} league={league} />)}
          </View>
        ) : (
          <View className="py-16 items-center">
            <View className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 items-center justify-center mb-4">
              <Trophy color="#E8B23A" size={28} />
            </View>
            <Text className="text-xl font-semibold text-white mb-2">No leagues yet</Text>
            <Text className="text-gray-400 mb-6 text-center max-w-xs">
              Draft a team of artists and compete with friends based on real streaming data
            </Text>
            <View className="flex-row gap-3">
              <Button onPress={() => navigation.navigate('LeagueCreate')}>
                <Plus color="#140D09" size={16} /> Create a League
              </Button>
              <Button variant="secondary" onPress={() => navigation.navigate('LeagueJoin')}>
                <Users color="#F3E7CE" size={16} /> Join a League
              </Button>
            </View>
          </View>
        )}

        <View className="gap-4">
          <MoversCard label="Songs" Icon={Music} data={movers?.songs} />
          <MoversCard label="Albums" Icon={Disc3} data={movers?.albums} />
          <ActivityCard items={allActivity?.items} />
        </View>
      </ScrollView>
    </View>
  );
}
