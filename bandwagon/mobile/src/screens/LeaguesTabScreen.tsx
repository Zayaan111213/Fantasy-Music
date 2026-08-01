import { View, Text, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Plus, Users, Trophy } from 'lucide-react-native';
import { api } from '../api/client';
import type { LeagueCard } from '@bandwagon/shared';
import { Header } from '../components/Header';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { LeagueRow } from '../components/LeagueRow';

// New — the web app has no dedicated "Leagues" landing (create/join +
// leagues list both live on Home), but a bottom-tab structure needs a real
// destination for this tab, so it doubles as a full leagues list too.
export function LeaguesTabScreen() {
  const navigation = useNavigation<any>();

  const { data: leagues, isLoading } = useQuery({
    queryKey: ['leagues'],
    queryFn: () => api.get<LeagueCard[]>('/leagues'),
  });

  return (
    <View className="flex-1 bg-gray-950">
      <Header showWordmark showBack={false} />
      <ScrollView contentContainerClassName="px-4 py-6 gap-4">
        <View>
          <Text className="text-2xl font-bold text-white">Leagues</Text>
          <Text className="text-gray-400 text-sm mt-0.5">Everything you're playing in, plus ways to join more</Text>
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
          <View className="py-16 items-center">
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
            <Text className="text-gray-400 text-center max-w-xs">
              Create your own league or join a friend's using an invite code.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
