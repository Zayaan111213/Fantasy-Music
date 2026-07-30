import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Plus, Users } from 'lucide-react-native';
import { Header } from '../components/Header';
import { Button } from '../components/ui/Button';

// New — the web app has no dedicated "Leagues" landing (create/join live on
// Home), but a bottom-tab structure needs a real destination for this tab.
export function LeaguesTabScreen() {
  const navigation = useNavigation<any>();
  return (
    <View className="flex-1 bg-gray-950">
      <Header showWordmark showBack={false} />
      <View className="flex-1 items-center justify-center gap-4 px-8">
        <Text className="text-xl font-semibold text-white">Leagues</Text>
        <Text className="text-gray-400 text-center">Create a new league or join one with an invite code.</Text>
        <View className="flex-row gap-3">
          <Button onPress={() => navigation.navigate('LeagueCreate')}>
            <Plus color="#140D09" size={16} /> Create
          </Button>
          <Button variant="secondary" onPress={() => navigation.navigate('LeagueJoin')}>
            <Users color="#F3E7CE" size={16} /> Join
          </Button>
        </View>
      </View>
    </View>
  );
}
