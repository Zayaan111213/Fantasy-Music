import { useState } from 'react';
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

// First letter of each of the first two words: "Nipsey Hussle" → NH,
// "KAROL G" → KG. Single-word names ("Drake") keep two letters so the circle
// doesn't look empty. Leading punctuation is skipped so "@zay's Squad" style
// names still initial correctly.
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0))
    .join('')
    .toUpperCase() || words[0].slice(0, 2).toUpperCase();
}

export function Avatar({ src, name, size = 'md' }: Props) {
  // An artist row can carry an image URL that 404s or is otherwise unloadable.
  // <Image> renders an empty box in that case, so failures fall back to the
  // same initials circle as a missing URL.
  // Keyed by URI, not a boolean, so a row whose src changes gets a fresh try
  // instead of inheriting the previous image's failure.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return src && failedSrc !== src ? (
    <Image source={{ uri: src }} className={`${sizes[size]} rounded-full`} onError={() => setFailedSrc(src)} />
  ) : (
    <View className={`${sizes[size]} rounded-full bg-indigo-500/30 border border-indigo-500/50 items-center justify-center`}>
      <Text className={`${textSizes[size]} font-semibold text-indigo-300`}>{initialsOf(name)}</Text>
    </View>
  );
}
