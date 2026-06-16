export const CHART_POSITION_TIERS = [
  { maxPos: 1, points: 25 },
  { maxPos: 10, points: 18 },
  { maxPos: 25, points: 12 },
  { maxPos: 50, points: 8 },
  { maxPos: 100, points: 4 },
] as const;

export function scoreChartPosition(position: number | null): number {
  if (!position) return 0;
  for (const tier of CHART_POSITION_TIERS) {
    if (position <= tier.maxPos) return tier.points;
  }
  return 0;
}

export function scoreChartMovement(movement: number | null, isNewEntry: boolean): number {
  if (isNewEntry) return 10;
  if (movement === null) return 0;
  if (movement > 0) return Math.min(movement, 15);
  return Math.max(movement, -10);
}

export function scoreStreaming(streams: number, tiers: { minStreams: bigint; maxStreams: bigint | null; points: number }[]): number {
  const s = BigInt(Math.round(streams));
  for (const tier of tiers) {
    if (s >= tier.minStreams && (tier.maxStreams === null || s <= tier.maxStreams)) {
      return tier.points;
    }
  }
  return 0;
}
