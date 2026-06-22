import { describe, it, expect } from 'vitest';
import { applyCustomScoringToWeeklyScore } from '../../scoring/engine';
import type { ScoringConfig } from '../../scoring/tiers';

const baseTiers = [
  { minStreams: BigInt(0), maxStreams: BigInt(999_999), points: 2 },
  { minStreams: BigInt(1_000_000), maxStreams: BigInt(4_999_999), points: 5 },
  { minStreams: BigInt(5_000_000), maxStreams: BigInt(14_999_999), points: 10 },
  { minStreams: BigInt(15_000_000), maxStreams: BigInt(49_999_999), points: 15 },
  { minStreams: BigInt(50_000_000), maxStreams: BigInt(99_999_999), points: 20 },
  { minStreams: BigInt(100_000_000), maxStreams: BigInt(199_999_999), points: 25 },
  { minStreams: BigInt(200_000_000), maxStreams: null, points: 30 },
];

const defaultConfig: ScoringConfig = {
  chartPosition: [25, 18, 12, 8, 4],
  chartMovement: { newEntryBonus: 10, maxGain: 15, maxDrop: 10 },
  streaming: {
    Pop: [2, 5, 10, 15, 20, 25, 30],
  },
};

describe('applyCustomScoringToWeeklyScore', () => {
  it('returns zero streaming points when weeklyStreams is null', () => {
    const ws = { weeklyStreams: null, bestChartPosition: null, chartMovement: null };
    const result = applyCustomScoringToWeeklyScore(ws, 'Pop', baseTiers, defaultConfig);
    expect(result.streamingPoints).toBe(0);
  });

  it('calculates streaming points from genre tiers with custom points', () => {
    const ws = { weeklyStreams: BigInt(2_000_000), bestChartPosition: null, chartMovement: null };
    const result = applyCustomScoringToWeeklyScore(ws, 'Pop', baseTiers, defaultConfig);
    expect(result.streamingPoints).toBe(5);
  });

  it('falls back to Pop config when genre not in custom streaming config', () => {
    const ws = { weeklyStreams: BigInt(2_000_000), bestChartPosition: null, chartMovement: null };
    const result = applyCustomScoringToWeeklyScore(ws, 'Country', baseTiers, defaultConfig);
    expect(result.streamingPoints).toBe(5);
  });

  it('applies custom chart position tiers', () => {
    const ws = { weeklyStreams: null, bestChartPosition: 1, chartMovement: null };
    const customCfg: ScoringConfig = {
      ...defaultConfig,
      chartPosition: [50, 30, 20, 10, 5],
    };
    const result = applyCustomScoringToWeeklyScore(ws, 'Pop', baseTiers, customCfg);
    expect(result.chartPositionPoints).toBe(50);
  });

  it('applies custom chart movement config', () => {
    const ws = { weeklyStreams: null, bestChartPosition: null, chartMovement: 20 };
    const customCfg: ScoringConfig = {
      ...defaultConfig,
      chartMovement: { newEntryBonus: 10, maxGain: 8, maxDrop: 5 },
    };
    const result = applyCustomScoringToWeeklyScore(ws, 'Pop', baseTiers, customCfg);
    expect(result.chartMovementPoints).toBe(8);
  });

  it('detects new entry when chartMovement is null and bestChartPosition is set', () => {
    const ws = { weeklyStreams: null, bestChartPosition: 42, chartMovement: null };
    const result = applyCustomScoringToWeeklyScore(ws, 'Pop', baseTiers, defaultConfig);
    expect(result.chartMovementPoints).toBe(10);
  });

  it('does not detect new entry when both chartMovement and bestChartPosition are null', () => {
    const ws = { weeklyStreams: null, bestChartPosition: null, chartMovement: null };
    const result = applyCustomScoringToWeeklyScore(ws, 'Pop', baseTiers, defaultConfig);
    expect(result.chartMovementPoints).toBe(0);
  });

  it('sums all three components correctly', () => {
    const ws = { weeklyStreams: BigInt(2_000_000), bestChartPosition: 10, chartMovement: 5 };
    const result = applyCustomScoringToWeeklyScore(ws, 'Pop', baseTiers, defaultConfig);
    expect(result.totalPoints).toBe(result.streamingPoints + result.chartPositionPoints + result.chartMovementPoints);
  });

  it('uses genre-specific streaming config when available', () => {
    const cfgWithCountry: ScoringConfig = {
      ...defaultConfig,
      streaming: {
        Pop: [2, 5, 10, 15, 20, 25, 30],
        Country: [4, 8, 14, 20, 26, 32, 38],
      },
    };
    const ws = { weeklyStreams: BigInt(2_000_000), bestChartPosition: null, chartMovement: null };
    const result = applyCustomScoringToWeeklyScore(ws, 'Country', baseTiers, cfgWithCountry);
    expect(result.streamingPoints).toBe(8);
  });
});
