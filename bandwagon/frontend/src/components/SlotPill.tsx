// Vintage slot palette, shared by roster slot pills (My Team, Matchup, Draft)
// and genre badges (player lists) so a genre reads as the same color
// everywhere. rgb triples so tints work in inline styles (and jsdom tests).
export const SLOT_RGB: Record<string, string> = {
  'R&B/Hip-Hop': '232, 178, 58', // harvest gold
  'Pop': '224, 122, 62', // burnt orange
  'Rock & Alternative': '194, 74, 46', // brick
  'Country': '183, 138, 60', // ochre
  'Other': '111, 165, 149', // muted teal
  'Flex': '200, 155, 106', // tan
  'Bench': '124, 102, 80', // dim
};

export function tintStyle(rgb: string) {
  return {
    color: `rgb(${rgb})`,
    backgroundColor: `rgba(${rgb}, 0.16)`,
    borderColor: `rgba(${rgb}, 0.42)`,
  };
}

// Genres beyond the four named slots (Latin, K-Pop, Dance, …) play in the
// Other slot, so they take the Other tint.
export function genreRgb(genre: string): string {
  return SLOT_RGB[genre] ?? SLOT_RGB['Other'];
}

export function SlotPill({ slot }: { slot: string }) {
  const short: Record<string, string> = { 'Rock & Alternative': 'Rock/Alt' };
  // Extra-compact labels for phone widths, where the pill sits in narrow
  // fixed grid tracks (H2H roster center column).
  const compactMap: Record<string, string> = { 'R&B/Hip-Hop': 'R&B', 'Rock & Alternative': 'Rock' };
  const isBench = slot.startsWith('Bench');
  const display = isBench ? 'Bench' : (short[slot] ?? slot);
  const compact = isBench ? 'Bench' : (compactMap[slot] ?? slot);
  const rgb = isBench ? SLOT_RGB['Bench'] : (SLOT_RGB[slot] ?? SLOT_RGB['Other']);
  return (
    <span
      className="inline-block text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full border whitespace-nowrap"
      style={tintStyle(rgb)}
    >
      {/* Desktop label first: e2e and text-locators resolve .first() to the visible span */}
      <span className="hidden sm:inline">{display}</span>
      <span className="sm:hidden">{compact}</span>
    </span>
  );
}
