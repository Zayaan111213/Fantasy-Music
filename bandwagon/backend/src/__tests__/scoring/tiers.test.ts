import { describe, it, expect } from 'vitest';
import {
  scoreChartPosition,
  scoreChartMovement,
  scoreStreaming,
  CHART_POSITION_TIERS,
} from '../../scoring/tiers';

describe('scoreChartPosition', () => {
  it('returns 0 for null position', () => {
    expect(scoreChartPosition(null)).toBe(0);
  });

  it('returns 25 for position 1', () => {
    expect(scoreChartPosition(1)).toBe(25);
  });

  it('returns 18 for position 10', () => {
    expect(scoreChartPosition(10)).toBe(18);
  });

  it('returns 12 for position 25', () => {
    expect(scoreChartPosition(25)).toBe(12);
  });

  it('returns 8 for position 50', () => {
    expect(scoreChartPosition(50)).toBe(8);
  });

  it('returns 4 for position 100', () => {
    expect(scoreChartPosition(100)).toBe(4);
  });

  it('returns 0 for position 101', () => {
    expect(scoreChartPosition(101)).toBe(0);
  });

  it('returns 25 for any position in the top tier (e.g. position 1)', () => {
    expect(scoreChartPosition(1, CHART_POSITION_TIERS)).toBe(25);
  });

  it('respects custom tiers', () => {
    const customTiers = [
      { maxPos: 1, points: 50 },
      { maxPos: 10, points: 30 },
    ];
    expect(scoreChartPosition(1, customTiers)).toBe(50);
    expect(scoreChartPosition(5, customTiers)).toBe(30);
    expect(scoreChartPosition(11, customTiers)).toBe(0);
  });
});

describe('scoreChartMovement', () => {
  const defaultConfig = { newEntryBonus: 10, maxGain: 15, maxDrop: 10 };

  it('returns newEntryBonus when isNewEntry is true', () => {
    expect(scoreChartMovement(null, true)).toBe(10);
    expect(scoreChartMovement(5, true)).toBe(10);
  });

  it('returns 0 when movement is null and not a new entry', () => {
    expect(scoreChartMovement(null, false)).toBe(0);
  });

  it('returns movement amount when positive and under maxGain', () => {
    expect(scoreChartMovement(8, false)).toBe(8);
  });

  it('caps positive movement at maxGain', () => {
    expect(scoreChartMovement(20, false)).toBe(15);
    expect(scoreChartMovement(15, false)).toBe(15);
  });

  it('returns negative movement when within maxDrop', () => {
    expect(scoreChartMovement(-5, false)).toBe(-5);
  });

  it('caps negative movement at -maxDrop', () => {
    expect(scoreChartMovement(-15, false)).toBe(-10);
    expect(scoreChartMovement(-10, false)).toBe(-10);
  });

  it('returns 0 for zero movement', () => {
    expect(scoreChartMovement(0, false)).toBe(0);
  });

  it('uses custom config values', () => {
    const cfg = { newEntryBonus: 20, maxGain: 5, maxDrop: 3 };
    expect(scoreChartMovement(null, true, cfg)).toBe(20);
    expect(scoreChartMovement(10, false, cfg)).toBe(5);
    expect(scoreChartMovement(-8, false, cfg)).toBe(-3);
  });
});

describe('scoreStreaming', () => {
  const tiers = [
    { minStreams: BigInt(0), maxStreams: BigInt(999_999), points: 2 },
    { minStreams: BigInt(1_000_000), maxStreams: BigInt(4_999_999), points: 5 },
    { minStreams: BigInt(5_000_000), maxStreams: BigInt(14_999_999), points: 10 },
    { minStreams: BigInt(15_000_000), maxStreams: null, points: 20 },
  ];

  it('returns points for lowest tier', () => {
    expect(scoreStreaming(500_000, tiers)).toBe(2);
  });

  it('returns points for a middle tier', () => {
    expect(scoreStreaming(2_000_000, tiers)).toBe(5);
  });

  it('returns points for upper-middle tier', () => {
    expect(scoreStreaming(10_000_000, tiers)).toBe(10);
  });

  it('returns points for the unbounded top tier (maxStreams = null)', () => {
    expect(scoreStreaming(50_000_000, tiers)).toBe(20);
  });

  it('returns 0 when stream count matches no tier', () => {
    const boundedTiers = [
      { minStreams: BigInt(1_000_000), maxStreams: BigInt(4_999_999), points: 5 },
    ];
    expect(scoreStreaming(500, boundedTiers)).toBe(0);
  });

  it('handles exact boundary values', () => {
    expect(scoreStreaming(1_000_000, tiers)).toBe(5);
    expect(scoreStreaming(4_999_999, tiers)).toBe(5);
    expect(scoreStreaming(5_000_000, tiers)).toBe(10);
  });

  it('returns 0 for empty tiers array', () => {
    expect(scoreStreaming(1_000_000, [])).toBe(0);
  });
});
