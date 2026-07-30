import { View, ActivityIndicator } from 'react-native';

export function Spinner({ size = 'small' as 'small' | 'large' }: { size?: 'small' | 'large' }) {
  return <ActivityIndicator size={size} color="#D9A02C" />;
}

export function FullPageSpinner() {
  return (
    <View className="flex-1 bg-gray-950 items-center justify-center">
      <Spinner size="large" />
    </View>
  );
}
