import { View, Text } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';

// Placeholder — real Home (leagues list, activity feed) lands in Phase 1.
// This screen exists only to prove the auth round trip: logged-in state
// persists a SecureStore-backed token and logout clears it.
export function HomeScreen() {
  const { user, logout } = useAuth();

  return (
    <View className="flex-1 bg-gray-950 items-center justify-center gap-4 px-4">
      <Text className="text-white text-lg">Welcome, {user?.username ?? user?.email}</Text>
      <Button variant="secondary" onPress={() => logout()}>
        Log Out
      </Button>
    </View>
  );
}
