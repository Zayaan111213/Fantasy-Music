import { View, Text, Image } from 'react-native';

interface Props {
  src: string | null | undefined;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizes: Record<string, string> = {
  sm: 'w-7 h-7',
  md: 'w-9 h-9',
  lg: 'w-12 h-12',
  xl: 'w-20 h-20',
};

const textSizes: Record<string, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
  xl: 'text-2xl',
};

export function Avatar({ src, name, size = 'md' }: Props) {
  return src ? (
    <Image source={{ uri: src }} className={`${sizes[size]} rounded-full`} />
  ) : (
    <View className={`${sizes[size]} rounded-full bg-indigo-500/30 border border-indigo-500/50 items-center justify-center`}>
      <Text className={`${textSizes[size]} font-semibold text-indigo-300`}>{name.slice(0, 2).toUpperCase()}</Text>
    </View>
  );
}
