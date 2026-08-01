import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronRight, Clock } from 'lucide-react-native';
import type { LeagueCard } from '@bandwagon/shared';
import { Card } from './ui/Card';
import { Button } from './ui/Button';

// Extracted from HomeScreen so the Leagues tab can show "leagues you're
// already in" too, not just Create/Join.
export function StatusBadge({ status }: { status: string }) {
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

export function LeagueRow({ league }: { league: LeagueCard }) {
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
