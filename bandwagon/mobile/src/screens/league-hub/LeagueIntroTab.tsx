import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Sparkles, AlarmClock, Users } from 'lucide-react-native';
import type { League, Team } from '@bandwagon/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { formatPacific } from '../../utils/draftTime';

export function LeagueIntroTab({ leagueId, league, isCommissioner }: {
  leagueId: string;
  league: League & { teams?: Team[] };
  isCommissioner: boolean;
}) {
  const navigation = useNavigation<any>();
  const isPreDraft = league.status === 'pre_draft';
  const teams = league.teams ?? [];

  return (
    <View className="gap-4">
      <Card className="p-6 items-center">
        <View className="w-14 h-14 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 items-center justify-center mb-4">
          <Sparkles color="#D9A02C" size={28} />
        </View>
        <Text className="text-xl font-bold text-white mb-1">Welcome to {league.name}!</Text>
        <Text className="text-gray-400 text-sm text-center max-w-sm">
          Rosters fill up at the draft, so there's nothing to manage until then. Here's what to expect.
        </Text>
      </Card>

      <Card className="p-5">
        <View className="flex-row items-center gap-2 mb-3">
          <AlarmClock color="#A88F70" size={16} />
          <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Draft Time (Pacific)</Text>
        </View>
        {league.draftTime ? (
          <>
            <Text className="text-lg font-semibold text-white">
              {formatPacific(league.draftTime, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </Text>
            {isPreDraft ? (
              <Button size="sm" className="mt-3 self-start" onPress={() => navigation.navigate('DraftRoom', { leagueId })}>
                Join Draft Lobby
              </Button>
            ) : (
              <Text className="text-xs text-gray-500 mt-1">We'll take you to the draft room automatically when it's time.</Text>
            )}
          </>
        ) : (
          <Text className="text-sm text-gray-500">
            {isCommissioner ? 'Set a draft time in the Settings tab to get started.' : "The commissioner hasn't scheduled a draft time yet."}
          </Text>
        )}
      </Card>

      <Card className="p-5">
        <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">How Bandwagoner Works</Text>
        <View className="gap-2.5">
          <Text className="text-sm text-gray-300">• Draft a 9-artist roster: 6 starters across R&B/Hip-Hop, Pop, Rock & Alternative, Country, Other, and Flex, plus 3 bench spots.</Text>
          <Text className="text-sm text-gray-300">• Each week your artists score points from real Apple Music chart position, movement, and longevity.</Text>
          <Text className="text-sm text-gray-300">• Set your lineup on Mondays, then it locks Tuesday through Sunday while scores roll in.</Text>
          <Text className="text-sm text-gray-300">• Head-to-head matchups all season, then the top teams make the playoffs.</Text>
        </View>
      </Card>

      <Card className="p-5">
        <View className="flex-row items-center gap-2 mb-3">
          <Users color="#A88F70" size={16} />
          <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Who's In</Text>
        </View>
        <View className="gap-2.5">
          {teams.map((t) => (
            <View key={t.id} className="flex-row items-center gap-2.5">
              <Avatar src={t.logoUrl ?? t.user?.avatarUrl ?? null} name={t.name} size="sm" />
              <Text className="text-sm text-white flex-1" numberOfLines={1}>{t.name}</Text>
              {t.userId === league.commissionerId && <Text className="text-[10px] text-amber-400 font-medium">Commissioner</Text>}
            </View>
          ))}
        </View>
        <Text className="text-xs text-gray-500 mt-3">{teams.length}/{league.teamCount} teams joined</Text>
      </Card>
    </View>
  );
}
