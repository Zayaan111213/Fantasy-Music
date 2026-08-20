import { useState } from 'react';

interface Props {
  src: string | null | undefined;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizes = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-20 h-20 text-2xl',
};

// First letter of each of the first two words: "Nipsey Hussle" → NH,
// "KAROL G" → KG. Single-word names ("Drake") keep two letters so the circle
// doesn't look empty. Leading punctuation is skipped so names like "'til dawn"
// still initial correctly.
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  const joined = words
    .slice(0, 2)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0))
    .join('')
    .toUpperCase();
  return joined || words[0].slice(0, 2).toUpperCase();
}

export function Avatar({ src, name, size = 'md' }: Props) {
  // An artist row can carry an image URL that 404s or is otherwise unloadable.
  // A broken <img> renders as an empty box, so failures fall back to the same
  // initials circle as a missing URL. Keyed by URI, not a boolean, so a
  // changed src gets a fresh try instead of inheriting the old failure.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return src && failedSrc !== src ? (
    <img
      src={src}
      alt={name}
      onError={() => setFailedSrc(src)}
      className={`${sizes[size]} rounded-full object-cover ring-2 ring-white/10`}
    />
  ) : (
    <div className={`${sizes[size]} rounded-full bg-indigo-500/30 border border-indigo-500/50 flex items-center justify-center font-semibold text-indigo-300`}>
      {initialsOf(name)}
    </div>
  );
}
