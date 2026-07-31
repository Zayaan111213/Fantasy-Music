import { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, UserPlus, ArrowLeftRight, Trophy, Sparkles, AlarmClock, Users, Mail } from 'lucide-react-native';
import { api } from '../../api/client';
import type { ActivityFeed, ActivityItem } from '@bandwagon/shared';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { timeAgo } from '../../utils/timeAgo';

const ACTIVITY_ICONS: Record<string, { Icon: typeof Bell; color: string }> = {
  claim: { Icon: UserPlus, color: '#6FA595' },
  waiver_won: { Icon: UserPlus, color: '#6FA595' },
  waiver_result: { Icon: UserPlus, color: '#D9A02C' },
  member_joined: { Icon: UserPlus, color: '#D9A02C' },
  trade_proposed: { Icon: Mail, color: '#D9A02C' },
  trade_accepted: { Icon: ArrowLeftRight, color: '#EFA36B' },
  trade_executed: { Icon: ArrowLeftRight, color: '#6FA595' },
  trade_vetoed: { Icon: ArrowLeftRight, color: '#D5714F' },
  trade_rejected: { Icon: ArrowLeftRight, color: '#D5714F' },
  trade_cancelled: { Icon: ArrowLeftRight, color: '#A88F70' },
  trade_failed: { Icon: ArrowLeftRight, color: '#D5714F' },
  week_result: { Icon: Trophy, color: '#EFA36B' },
  playoffs_set: { Icon: Trophy, color: '#D9A02C' },
  season_complete: { Icon: Trophy, color: '#EFA36B' },
  league_renewed: { Icon: Sparkles, color: '#D9A02C' },
  lineup_reminder: { Icon: AlarmClock, color: '#D9A02C' },
  draft_complete: { Icon: Sparkles, color: '#D9A02C' },
  member_left: { Icon: UserPlus, color: '#A88F70' },
  commissioner_transfer: { Icon: Users, color: '#D9A02C' },
  commissioner_transferred: { Icon: Users, color: '#D9A02C' },
};

export function NotificationsTab({ leagueId }: { leagueId: string }) {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { data: feed } = useQuery({
    queryKey: ['activity', leagueId],
    queryFn: () => api.get<ActivityFeed>(`/leagues/${leagueId}/activity`),
  });

  const markSeen = useMutation({
    mutationFn: () => api.post(`/leagues/${leagueId}/notifications/seen`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['activity', leagueId] }),
  });

  const unseenCount = feed?.unseenCount ?? 0;
  useEffect(() => {
    if (unseenCount > 0 && !markSeen.isPending) markSeen.mutate();
  }, [unseenCount]);

  const items = feed?.items ?? [];
  if (items.length === 0) {
    return (
      <Card className="p-10 items-center gap-3">
        <Bell color="#5F4936" size={32} />
        <Text className="text-gray-400 text-sm text-center">Nothing yet. League activity will show up here.</Text>
      </Card>
    );
  }

  return (
    <Card>
      {items.map((item: ActivityItem) => {
        const { Icon, color } = ACTIVITY_ICONS[item.type] ?? { Icon: Bell, color: '#A88F70' };
        return (
          <View
            key={`${item.kind}-${item.id}`}
            className={`flex-row items-start gap-3 px-4 py-3 border-b border-white/5 last:border-0 ${item.kind === 'personal' ? 'border-l-2' : ''}`}
            style={item.kind === 'personal' ? { backgroundColor: 'rgba(217,160,44,0.05)', borderLeftColor: '#D9A02C' } : undefined}
          >
            <View className="mt-0.5"><Icon color={color} size={16} /></View>
            <View className="flex-1 min-w-0">
              <Text className="text-sm text-gray-200">{item.message}</Text>
              {item.kind === 'personal' && item.type === 'trade_proposed' && (
                <Pressable onPress={() => navigation.navigate('TradePropose', { leagueId })}>
                  <Text className="text-xs text-indigo-400">View offer →</Text>
                </Pressable>
              )}
            </View>
            <View className="items-end gap-1">
              {item.kind === 'personal' && <Badge className="text-[10px]">For you</Badge>}
              <Text className="text-xs text-gray-500">{timeAgo(item.createdAt)}</Text>
            </View>
          </View>
        );
      })}
    </Card>
  );
}
