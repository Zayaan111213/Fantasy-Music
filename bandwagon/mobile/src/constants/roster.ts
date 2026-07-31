export const ALL_STARTER_SLOTS = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Other', 'Flex'];
export const ALL_BENCH_SLOTS = ['Bench-1', 'Bench-2', 'Bench-3'];

const MAIN_GENRES = new Set(['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country']);
export function canFillSlot(genre: string, slot: string): boolean {
  if (slot.startsWith('Bench') || slot === 'Flex') return true;
  if (slot === 'Other') return !MAIN_GENRES.has(genre);
  return genre === slot;
}
