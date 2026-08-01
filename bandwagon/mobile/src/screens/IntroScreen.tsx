import { View, Text, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Plus, Users, TrendingUp, Trophy, Music, Disc3 } from 'lucide-react-native';
import { api } from '../api/client';
import type { MoversPayload } from '@bandwagon/shared';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { MoversCard } from '../components/ChartMovers';
import { WagonMark, Wordmark } from '../components/Logo';

// Ported from frontend/src/pages/Landing.tsx — the unauthenticated cover
// screen, now the AuthStack's initial route instead of dropping straight
// into Login.
export function IntroScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const { data: movers } = useQuery({
    queryKey: ['chartMovers'],
    queryFn: () => api.get<MoversPayload>('/charts/movers?limit=3'),
  });

  return (
    <View className="flex-1 bg-gray-950">
      <View
        className="flex-row items-center justify-between px-4 pb-4 border-b border-white/10"
        style={{ paddingTop: insets.top + 16 }}
      >
        <View className="flex-row items-center gap-2">
          <WagonMark size={32} />
          <Wordmark className="text-lg" />
        </View>
        <Pressable onPress={() => navigation.navigate('Login')} className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5">
          <Text className="text-white text-sm font-medium">Log In</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerClassName="px-4 pb-10">
        <View className="items-center py-12">
          <WagonMark size={72} />
          <Text className="text-3xl font-bold text-white mt-5 text-center">Fantasy sports for music fans</Text>
          <Text className="text-gray-400 text-center mt-3 max-w-xs">
            Draft real recording artists, compete head-to-head with friends, and score points off the real Apple Music charts every week.
          </Text>
          <View className="gap-3 mt-8 w-full max-w-xs">
            <Button size="lg" onPress={() => navigation.navigate('Login', { mode: 'signup' })}>
              <Plus color="#140D09" size={16} /> Create a League
            </Button>
            <Button variant="secondary" size="lg" onPress={() => navigation.navigate('Login', { mode: 'signup' })}>
              <Users color="#F3E7CE" size={16} /> Join a League
            </Button>
          </View>
        </View>

        <View className="gap-4 pb-8">
          <Card className="p-5">
            <Users color="#D9A02C" size={20} />
            <Text className="font-semibold text-white mt-2 mb-1">Draft your roster</Text>
            <Text className="text-sm text-gray-400">
              Live snake draft with friends. 9-artist rosters: 6 starters across R&B/Hip-Hop, Pop, Rock & Alternative, Country, Other, and Flex, plus 3 bench spots.
            </Text>
          </Card>
          <Card className="p-5">
            <TrendingUp color="#D9A02C" size={20} />
            <Text className="font-semibold text-white mt-2 mb-1">Score off the charts</Text>
            <Text className="text-sm text-gray-400">
              Points come from real Apple Music Most Played Songs and Albums charts: chart position, weekly movement, and longevity on the chart.
            </Text>
          </Card>
          <Card className="p-5">
            <Trophy color="#D9A02C" size={20} />
            <Text className="font-semibold text-white mt-2 mb-1">Win your matchup</Text>
            <Text className="text-sm text-gray-400">
              Face another team head-to-head each week. After a 10-week regular season, the top 4 teams battle in the playoffs for the league title.
            </Text>
          </Card>
        </View>

        <View className="gap-4 pb-8">
          <MoversCard label="Songs" Icon={Music} data={movers?.songs} linkToCharts={false} interactive={false} />
          <MoversCard label="Albums" Icon={Disc3} data={movers?.albums} linkToCharts={false} interactive={false} />
        </View>

        <View className="flex-row items-center justify-center gap-2">
          <Text className="text-sm text-gray-500">Already have an account?</Text>
          <Pressable onPress={() => navigation.navigate('Login')}>
            <Text className="text-sm text-indigo-400 font-medium">Log in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
