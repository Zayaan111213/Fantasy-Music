import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { MoreVertical } from 'lucide-react-native';
import { api } from '../../api/client';
import type { Bracket, League, StandingsEntry } from '@bandwagon/shared';
import { Card } from '../../components/ui/Card';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { BracketCard } from '../../components/BracketCard';
import { ReportBlockSheet } from '../../components/ReportBlockSheet';
import { useAuth } from '../../context/AuthContext';
import { REGULAR_SEASON_WEEKS } from '../../utils/weekPhase';

export function StandingsTab({ leagueId, league }: { leagueId: string; league: League }) {
  const { user } = useAuth();
  const myUserId = user?.id;
  const [reportTarget, setReportTarget] = useState<StandingsEntry | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['standings', leagueId],
    queryFn: () => api.get<StandingsEntry[]>(`/leagues/${leagueId}/standings`),
  });

  const { data: bracket } = useQuery({
    queryKey: ['bracket', leagueId],
    queryFn: () => api.get<Bracket | null>(`/leagues/${leagueId}/bracket`),
    enabled: league.status === 'active' || league.status === 'complete',
  });

  if (isLoading) return <View className="py-12 items-center"><Spinner size="large" /></View>;

  const playoffCutline = 4;
  const inPlayoffs = league.currentWeek > REGULAR_SEASON_WEEKS || league.status === 'complete';

  return (
    <View className="gap-4">
      <Card>
        <View className="p-4 border-b border-white/10 flex-row">
          <Text className="w-8 text-xs text-gray-500 uppercase tracking-wider font-medium">#</Text>
          <Text className="flex-1 text-xs text-gray-500 uppercase tracking-wider font-medium">Team</Text>
          <Text className="w-14 text-xs text-gray-500 uppercase tracking-wider font-medium text-center">W-L</Text>
          <Text className="w-16 text-xs text-gray-500 uppercase tracking-wider font-medium text-right">Pts</Text>
        </View>
        {inPlayoffs && (
          <View className="px-4 py-2 border-b border-white/10">
            <Text className="text-xs text-gray-500">{league.status === 'complete' ? 'Final regular-season standings' : 'Regular-season record · playoffs in progress'}</Text>
          </View>
        )}
        {data?.map((entry, i) => (
          <View key={entry.teamId}>
            {i === playoffCutline && (
              <View className="px-4 py-1 border-y" style={{ backgroundColor: 'rgba(142,111,168,0.1)', borderColor: 'rgba(142,111,168,0.2)' }}>
                <Text className="text-center text-xs" style={{ color: '#8E6FA8' }}>{inPlayoffs ? '── Playoffs ──' : '── Playoff Line ──'}</Text>
              </View>
            )}
            <View className="flex-row items-center p-4">
              <Text className="w-8 text-gray-500 font-mono text-sm">{entry.rank}</Text>
              <View className="flex-1 flex-row items-center gap-2 min-w-0">
                <Avatar src={entry.avatarUrl} name={entry.username ?? '?'} size="sm" />
                <View className="min-w-0">
                  <Text className="text-sm font-medium text-white" numberOfLines={1}>{entry.teamName}</Text>
                  <Text className="text-xs text-gray-500" numberOfLines={1}>{entry.username}</Text>
                </View>
              </View>
              <Text className="w-14 text-center text-sm font-semibold text-white">{entry.wins}-{entry.losses}</Text>
              <Text className="w-16 text-right text-sm text-gray-300 font-mono">{entry.pointsFor.toFixed(1)}</Text>
              {/*
                Report/block entry point. Standings is the one screen listing
                every other member, so it's where guideline 1.2's affordances
                belong. Hidden on your own row.
              */}
              {entry.userId !== myUserId && (
                <Pressable
                  onPress={() => setReportTarget(entry)}
                  hitSlop={8}
                  className="w-6 items-end"
                  accessibilityLabel={`Report or block ${entry.username ?? entry.teamName}`}
                >
                  <MoreVertical color="#6B7280" size={16} />
                </Pressable>
              )}
            </View>
          </View>
        ))}
      </Card>
      {bracket && <BracketCard bracket={bracket} />}
      {reportTarget && (
        <ReportBlockSheet
          visible
          onClose={() => setReportTarget(null)}
          targetType="team"
          targetId={reportTarget.teamId}
          targetName={reportTarget.username ?? reportTarget.teamName}
          userId={reportTarget.userId}
        />
      )}
    </View>
  );
}
