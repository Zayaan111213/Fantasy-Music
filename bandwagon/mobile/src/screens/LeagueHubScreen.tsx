import { View, Text } from 'react-native';
import { Header } from '../components/Header';

// Placeholder — real implementation (decomposed from the 2352-line web
// LeagueHub) lands in Phase 2.
export function LeagueHubScreen() {
  return (
    <View className="flex-1 bg-gray-950">
      <Header title="League" />
      <View className="flex-1 items-center justify-center">
        <Text className="text-gray-500">Coming in Phase 2</Text>
      </View>
    </View>
  );
}
