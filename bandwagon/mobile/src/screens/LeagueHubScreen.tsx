import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { User, Swords, Trophy, Users, Bell, Settings, Sparkles } from 'lucide-react-native';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { ActivityFeed, League, Team } from '@bandwagon/shared';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { Header } from '../components/Header';
import { getWeekPhase } from '../utils/weekPhase';
import { MyTeamTab } from './league-hub/MyTeamTab';
import { MatchupTab } from './league-hub/MatchupTab';
import { StandingsTab } from './league-hub/StandingsTab';
import { PlayersTab } from './league-hub/PlayersTab';
import { NotificationsTab } from './league-hub/NotificationsTab';
import { SettingsTab } from './league-hub/SettingsTab';
import { LeagueIntroTab } from './league-hub/LeagueIntroTab';
import { SeasonCompleteBanner } from './league-hub/SeasonCompleteBanner';
import { ChampionPopup } from './league-hub/ChampionPopup';

type Tab = 'overview' | 'myteam' | 'matchup' | 'standings' | 'players' | 'notifications' | 'settings';

export function LeagueHubScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const leagueId: string = route.params.leagueId;
  const { user } = useAuth();

  const { data: league, isLoading } = useQuery({
    queryKey: ['league', leagueId],
    queryFn: () => api.get<League & { teams: Team[]; commissioner: { id: string; username: string | null } }>(`/leagues/${leagueId}`),
    refetchInterval: (query) => {
      const d = query.state.data;
      return !d || d.status === 'pending' || d.status === 'pre_draft' ? 5000 : false;
    },
  });

  const { data: activityFeed } = useQuery({
    queryKey: ['activity', leagueId],
    queryFn: () => api.get<ActivityFeed>(`/leagues/${leagueId}/activity`),
    refetchInterval: 45_000,
    retry: false,
  });
  const unseenCount = activityFeed?.unseenCount ?? 0;

  const isPreDraftPhase = league ? league.status === 'pending' || league.status === 'pre_draft' : false;
  const [tab, setTab] = useState<Tab | null>(null);
  const activeTab: Tab = tab ?? (isPreDraftPhase ? 'overview' : 'myteam');

  if (isLoading) return <View className="flex-1 bg-gray-950 items-center justify-center"><Spinner size="large" /></View>;
  if (!league) return <View className="flex-1 bg-gray-950 items-center justify-center"><Text className="text-gray-400">League not found</Text></View>;

  const isCommissioner = league.commissionerId === user?.id;
  const phase = getWeekPhase(league);

  const tabs: { id: Tab; label: string; Icon: typeof User }[] = [
    isPreDraftPhase ? { id: 'overview', label: 'Overview', Icon: Sparkles } : { id: 'myteam', label: 'My Team', Icon: User },
    { id: 'matchup', label: 'Matchup', Icon: Swords },
    { id: 'standings', label: 'Standings', Icon: Trophy },
    { id: 'players', label: 'Artists', Icon: Users },
    { id: 'notifications', label: 'Notifications', Icon: Bell },
    { id: 'settings', label: 'Settings', Icon: Settings },
  ];

  return (
    <View className="flex-1 bg-gray-950">
      <Header
        title={league.name}
        actions={
          (league.status === 'pre_draft' || league.status === 'drafting') ? (
            <Button size="sm" onPress={() => navigation.navigate('DraftRoom', { leagueId })}>
              {league.status === 'pre_draft' ? 'Draft Lobby' : 'Draft Live'}
            </Button>
          ) : undefined
        }
      />

      {/* All 6 tabs are icon+label pairs that don't fit a phone's width in
          a single row, so — unlike the web version's horizontal-scroll bar —
          each tab is icon-on-top/label-below and evenly distributed
          (flex-1) so nothing scrolls or gets clipped at the screen edge. */}
      <View className="flex-row border-b border-white/10">
        {tabs.map((t) => {
          const active = activeTab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              className={`flex-1 items-center gap-1 py-2.5 border-b-2 ${active ? 'border-indigo-500' : 'border-transparent'}`}
            >
              <View>
                <t.Icon color={active ? '#D9A02C' : '#7C6650'} size={18} />
                {t.id === 'notifications' && unseenCount > 0 && (
                  <View className="absolute -top-1 -right-2 min-w-[14px] h-[14px] px-0.5 rounded-full bg-indigo-500 items-center justify-center">
                    <Text className="text-gray-950 text-[9px] font-semibold">{unseenCount}</Text>
                  </View>
                )}
              </View>
              <Text className={`text-[10px] font-medium ${active ? 'text-indigo-400' : 'text-gray-500'}`} numberOfLines={1}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {league.status === 'complete' && <ChampionPopup leagueId={leagueId} league={league} />}

      <ScrollView contentContainerClassName="px-4 py-6">
        {league.status === 'complete' && <SeasonCompleteBanner leagueId={leagueId} league={league} isCommissioner={isCommissioner} />}
        {activeTab === 'overview' && <LeagueIntroTab leagueId={leagueId} league={league} isCommissioner={isCommissioner} />}
        {activeTab === 'myteam' && <MyTeamTab leagueId={leagueId} league={league} phase={phase} />}
        {activeTab === 'matchup' && <MatchupTab leagueId={leagueId} league={league} phase={phase} />}
        {activeTab === 'standings' && <StandingsTab leagueId={leagueId} league={league} />}
        {activeTab === 'players' && (
          <PlayersTab
            leagueId={leagueId}
            league={league}
            onProposeTrade={(_teamId, artistId) => navigation.navigate('TradePropose', { leagueId, artistId })}
          />
        )}
        {activeTab === 'notifications' && <NotificationsTab leagueId={leagueId} />}
        {activeTab === 'settings' && <SettingsTab leagueId={leagueId} league={league} />}
      </ScrollView>
    </View>
  );
}
