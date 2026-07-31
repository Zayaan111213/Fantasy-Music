import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Plus, Users, Trophy, ChevronRight, Clock, X, Music, Disc3 } from 'lucide-react-native';
import { api } from '../api/client';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { Avatar } from '../components/ui/Avatar';
import { Header } from '../components/Header';
import type { ChartRow, GlobalActivityItem, LeagueCard, MoversPayload, Notification } from '@bandwagon/shared';
import { timeAgo } from '../utils/timeAgo';

// Ported from frontend/src/pages/Home.tsx. The PWA install banner and
// HowItWorksModal are web-only concepts (native install happens via the App
// Store) and are dropped rather than ported.

function MoverRow({ row }: { row: ChartRow }) {
  const navigation = useNavigation<any>();
  const up = (row.delta ?? 0) > 0;
  const a = row.artists[0];
  return (
    <Pressable
      disabled={!a}
      onPress={() => a && navigation.navigate('ArtistDetail', { artistId: a.id })}
      className="flex-row items-center gap-3 py-2 border-b border-gray-900 last:border-0"
    >
      <Text className="w-6 font-serif text-base text-gray-500 text-center">{row.rank}</Text>
      {a ? (
        <Avatar src={a.imageUrl} name={a.name} size="sm" />
      ) : (
        <View className="w-8 h-8 rounded-lg bg-gray-800 border border-gray-700 items-center justify-center">
          <Text className="text-gray-500 text-xs">♪</Text>
        </View>
      )}
      <View className="flex-1 min-w-0">
        <Text className="text-sm font-semibold text-white" numberOfLines={1}>{row.title}</Text>
        <Text className="text-xs text-gray-400" numberOfLines={1}>{row.artists.map((x) => x.name).join(', ') || '—'}</Text>
      </View>
      <Text className={`text-[13px] font-bold ${up ? 'text-green-400' : 'text-red-400'}`}>
        {up ? '▲' : '▼'} {Math.abs(row.delta ?? 0)}
      </Text>
    </Pressable>
  );
}

function MoversCard({ label, Icon, data }: {
  label: string;
  Icon: typeof Music;
  data?: { risers: ChartRow[]; fallers: ChartRow[] };
}) {
  const navigation = useNavigation<any>();
  const rows = [...(data?.risers.slice(0, 3) ?? []), ...(data?.fallers.slice(0, 2) ?? [])];
  return (
    <Card className="p-5">
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center gap-2">
          <Icon color="#A88F70" size={14} />
          <Text className="text-[11px] font-bold uppercase tracking-widest text-gray-400">{label} · This Week's Movers</Text>
        </View>
        <Pressable onPress={() => navigation.navigate('Main', { screen: 'Charts' })}>
          <Text className="text-[11px] font-semibold text-indigo-400">Full chart →</Text>
        </Pressable>
      </View>
      {rows.length > 0 ? (
        rows.map((row) => <MoverRow key={row.rank} row={row} />)
      ) : (
        <Text className="text-sm text-gray-500 py-4 text-center">No chart movement yet this week.</Text>
      )}
    </Card>
  );
}

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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    pending: { label: 'Pre-Season', bg: 'rgba(224,163,107,0.2)', fg: '#EFA36B' },
    drafting: { label: 'Draft Live', bg: 'rgba(143,191,173,0.2)', fg: '#8FBFAD' },
    active: { label: 'Week Active', bg: 'rgba(232,178,58,0.2)', fg: '#F0C766' },
    complete: { label: 'Complete', bg: 'rgba(124,102,80,0.2)', fg: '#A88F70' },
  };
  const s = map[status] || map.pending;
  return (
    <View className="px-2 py-0.5 rounded" style={{ backgroundColor: s.bg }}>
      <Text className="text-xs font-medium" style={{ color: s.fg }}>{s.label}</Text>
    </View>
  );
}

function LeagueRow({ league }: { league: LeagueCard }) {
  const navigation = useNavigation<any>();
  return (
    <Pressable onPress={() => navigation.navigate('LeagueHub', { leagueId: league.id })}>
      <Card className="p-5">
        <View className="flex-row items-start justify-between mb-4">
          <View className="min-w-0 flex-1">
            <View className="flex-row flex-wrap items-center gap-2 mb-1">
              <Text className="font-semibold text-white">{league.name}</Text>
              <StatusBadge status={league.status} />
              {league.isCommissioner && (
                <View className="px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(239,163,107,0.2)' }}>
                  <Text className="text-xs font-medium" style={{ color: '#EFA36B' }}>Commissioner</Text>
                </View>
              )}
            </View>
            <Text className="text-sm text-gray-400">
              {league.myTeam.name} · {league.memberCount}/{league.teamCount} teams
            </Text>
          </View>
          <ChevronRight color="#5F4936" size={20} />
        </View>

        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <View className="items-center">
              <Text className="text-xl font-bold text-white">{league.myTeam.wins}</Text>
              <Text className="text-xs text-gray-500">W</Text>
            </View>
            <Text className="text-gray-600">-</Text>
            <View className="items-center">
              <Text className="text-xl font-bold text-white">{league.myTeam.losses}</Text>
              <Text className="text-xs text-gray-500">L</Text>
            </View>
          </View>

          {league.status === 'active' && league.opponent && (
            <View className="items-end">
              <View className="flex-row items-center gap-1 mb-1">
                <Clock color="#5F4936" size={12} />
                <Text className="text-xs text-gray-500">Week {league.currentWeek}</Text>
              </View>
              <Text className="text-sm font-semibold text-white">
                <Text className={league.myScore >= league.opponentScore ? 'text-green-400' : 'text-red-400'}>
                  {league.myScore.toFixed(1)}
                </Text>
                <Text className="text-gray-600"> vs </Text>
                {league.opponentScore.toFixed(1)}
              </Text>
              <Text className="text-xs text-gray-500">{league.opponent.name}</Text>
            </View>
          )}

          {(league.status === 'drafting' || league.status === 'pre_draft') && (
            <Button size="sm" onPress={() => navigation.navigate('DraftRoom', { leagueId: league.id })}>
              {league.status === 'drafting' ? 'Draft Live →' : 'Draft Lobby →'}
            </Button>
          )}

          {league.status === 'pending' && league.draftTime && (
            <View className="items-end">
              <View className="flex-row items-center gap-1 mb-1">
                <Clock color="#5F4936" size={12} />
                <Text className="text-xs text-gray-500">Draft</Text>
              </View>
              <Text className="text-sm font-semibold text-white">
                {new Date(league.draftTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })}
              </Text>
              <Text className="text-xs text-gray-500">
                {new Date(league.draftTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })} PT
              </Text>
            </View>
          )}
        </View>
      </Card>
    </Pressable>
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
            <Users color="#F3E7CE" size={16} /> Join
          </Button>
          <Button size="sm" className="flex-1" onPress={() => navigation.navigate('LeagueCreate')}>
            <Plus color="#140D09" size={16} /> Create
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
