import { View, Text, TextInput, type TextInputProps } from 'react-native';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  className?: string;
}

export function Input({ label, error, className = '', ...props }: Props) {
  return (
    <View className="flex flex-col gap-1">
      {label && <Text className="text-sm font-medium text-gray-300">{label}</Text>}
      <TextInput
        placeholderTextColor="#7C6650"
        className={`w-full bg-white/10 border ${error ? 'border-red-500' : 'border-white/20'} rounded-lg px-3 py-2.5 text-white ${className}`}
        {...props}
      />
      {error && <Text className="text-xs text-red-400">{error}</Text>}
    </View>
  );
}
