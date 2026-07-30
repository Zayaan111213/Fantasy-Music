import { View, Text } from 'react-native';
import { Header } from '../components/Header';

// Placeholder — real implementation (live socket draft) lands in Phase 3.
export function DraftRoomScreen() {
  return (
    <View className="flex-1 bg-gray-950">
      <Header title="Draft" />
      <View className="flex-1 items-center justify-center">
        <Text className="text-gray-500">Coming in Phase 3</Text>
      </View>
    </View>
  );
}
