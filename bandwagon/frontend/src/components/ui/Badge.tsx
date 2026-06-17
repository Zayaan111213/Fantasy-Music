import type { ReactNode } from 'react';

const GENRE_COLORS: Record<string, string> = {
  'R&B/Hip-Hop': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'Pop': 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  'Rock & Alternative': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'Country': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'Dance': 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'Latin': 'bg-red-500/20 text-red-300 border-red-500/30',
  'K-Pop': 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  'Afrobeats': 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  'Other': 'bg-teal-500/20 text-teal-300 border-teal-500/30',
};

export function Badge({ children, genre, className = '' }: { children: ReactNode; genre?: string; className?: string }) {
  const color = genre ? (GENRE_COLORS[genre] || 'bg-gray-500/20 text-gray-300 border-gray-500/30') : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${color} ${className}`}>
      {children}
    </span>
  );
}
