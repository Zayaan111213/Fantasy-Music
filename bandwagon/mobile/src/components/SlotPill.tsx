import { View, Text } from 'react-native';

// Ported from frontend/src/components/SlotPill.tsx. The web version renders
// both a full-width and a compact label and toggles them with sm:hidden — on
// mobile there's no "desktop" breakpoint, so we always use the compact form
// that was designed for the narrow phone-width cells.
export const SLOT_RGB: Record<string, string> = {
  'R&B/Hip-Hop': '232, 178, 58',
  Pop: '224, 122, 62',
  'Rock & Alternative': '194, 74, 46',
  Country: '183, 138, 60',
  Other: '111, 165, 149',
  Flex: '200, 155, 106',
  Bench: '124, 102, 80',
};

export function tintStyle(rgb: string) {
  return {
    color: `rgb(${rgb})`,
    backgroundColor: `rgba(${rgb}, 0.16)`,
    borderColor: `rgba(${rgb}, 0.42)`,
  };
}

export function genreRgb(genre: string): string {
  return SLOT_RGB[genre] ?? SLOT_RGB['Other'];
}

const GENRE_SHORT: Record<string, string> = { 'Rock & Alternative': 'Rock/Alt' };
export function genreLabel(genre: string): string {
  return GENRE_SHORT[genre] ?? genre;
}

const SLOT_SHORT: Record<string, string> = { 'R&B/Hip-Hop': 'R&B', 'Rock & Alternative': 'Rock' };

export function SlotPill({ slot }: { slot: string }) {
  const isBench = slot.startsWith('Bench');
  const display = isBench ? 'Bench' : (SLOT_SHORT[slot] ?? slot);
  const rgb = isBench ? SLOT_RGB['Bench'] : (SLOT_RGB[slot] ?? SLOT_RGB['Other']);
  const tint = tintStyle(rgb);
  return (
    <View
      className="px-1.5 py-0.5 rounded-full border self-start"
      style={{ backgroundColor: tint.backgroundColor, borderColor: tint.borderColor }}
    >
      <Text className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: tint.color }}>
        {display}
      </Text>
    </View>
  );
}
