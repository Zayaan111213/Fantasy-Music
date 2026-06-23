import { z } from 'zod';

export const CHART_POSITION_TIERS = [
  { maxPos: 1, points: 25 },
  { maxPos: 10, points: 18 },
  { maxPos: 25, points: 12 },
  { maxPos: 50, points: 8 },
  { maxPos: 100, points: 4 },
] as const;

export const ALBUM_CHART_POSITION_TIERS = [
  { maxPos: 1, points: 20 },
  { maxPos: 5, points: 14 },
  { maxPos: 10, points: 9 },
  { maxPos: 25, points: 5 },
  { maxPos: 50, points: 2 },
] as const;

export const DEFAULT_SONG_MOVEMENT  = { newEntryBonus: 8, maxGain: 12, maxDrop: 8 };
export const DEFAULT_ALBUM_MOVEMENT = { newEntryBonus: 6, maxGain: 8,  maxDrop: 5 };

export interface ScoringConfig {
  chartPosition: [number, number, number, number, number];
  chartMovement: { newEntryBonus: number; maxGain: number; maxDrop: number };
  streaming: Record<string, [number, number, number, number, number, number, number]>;
}

const PointTuple7 = z.tuple([
  z.number().int().min(0),
  z.number().int().min(0),
  z.number().int().min(0),
  z.number().int().min(0),
  z.number().int().min(0),
  z.number().int().min(0),
  z.number().int().min(0),
]);

export const ScoringConfigSchema = z.object({
  chartPosition: z.tuple([
    z.number().int().min(0),
    z.number().int().min(0),
    z.number().int().min(0),
    z.number().int().min(0),
    z.number().int().min(0),
  ]),
  chartMovement: z.object({
    newEntryBonus: z.number().int().min(0),
    maxGain: z.number().int().min(0),
    maxDrop: z.number().int().min(0),
  }),
  streaming: z.record(PointTuple7),
}).strict();

export function scoreChartPosition(
  position: number | null,
  tiers: ReadonlyArray<{ maxPos: number; points: number }> = CHART_POSITION_TIERS
): number {
  if (!position) return 0;
  for (const tier of tiers) {
    if (position <= tier.maxPos) return tier.points;
  }
  return 0;
}

export function scoreChartMovement(
  movement: number | null,
  isNewEntry: boolean,
  config: { newEntryBonus: number; maxGain: number; maxDrop: number } = { newEntryBonus: 10, maxGain: 15, maxDrop: 10 }
): number {
  if (isNewEntry) return config.newEntryBonus;
  if (movement === null) return 0;
  if (movement > 0) return Math.min(movement, config.maxGain);
  return Math.max(movement, -config.maxDrop);
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
