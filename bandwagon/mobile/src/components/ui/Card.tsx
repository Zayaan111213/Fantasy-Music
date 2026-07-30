import { View, type ViewProps } from 'react-native';

interface Props extends ViewProps {
  className?: string;
}

export function Card({ children, className = '', ...props }: Props) {
  return (
    <View className={`bg-gray-800 border border-gray-700 rounded-2xl ${className}`} {...props}>
      {children}
    </View>
  );
}
