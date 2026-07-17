import type { ReactNode } from 'react';
import { SLOT_RGB, genreRgb, tintStyle } from '../SlotPill';

// Genre badges share the vintage slot palette (see SlotPill.tsx): the four
// named slot genres get their slot color, every other genre reads as Other
// teal. Badges without a genre are brand gold.
export function Badge({ children, genre, className = '' }: { children: ReactNode; genre?: string; className?: string }) {
  const rgb = genre ? genreRgb(genre) : SLOT_RGB['R&B/Hip-Hop'];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${className}`}
      style={tintStyle(rgb)}
    >
      {children}
    </span>
  );
}
