import { View, Text } from 'react-native';
import type { ReactNode } from 'react';
import { SLOT_RGB, genreRgb, tintStyle } from '../SlotPill';

export function Badge({ children, genre, className = '' }: { children: ReactNode; genre?: string; className?: string }) {
  const rgb = genre ? genreRgb(genre) : SLOT_RGB['R&B/Hip-Hop'];
  const tint = tintStyle(rgb);
  return (
    <View
      className={`px-2 py-0.5 rounded-md border self-start ${className}`}
      style={{ backgroundColor: tint.backgroundColor, borderColor: tint.borderColor }}
    >
      <Text className="text-xs font-medium" style={{ color: tint.color }}>
        {children}
      </Text>
    </View>
  );
}
