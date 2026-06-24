import { describe, it, expect } from 'vitest';
import {
  scoreChartPosition,
  scoreChartMovement,
  scoreStreaming,
  scoreLongevity,
  CHART_POSITION_TIERS,
  ALBUM_CHART_POSITION_TIERS,
  DEFAULT_SONG_MOVEMENT,
  DEFAULT_ALBUM_MOVEMENT,
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

describe('scoreChartPosition — ALBUM_CHART_POSITION_TIERS', () => {
  it('returns 25 for rank 1', () => {
    expect(scoreChartPosition(1, ALBUM_CHART_POSITION_TIERS)).toBe(25);
  });
  it('returns 18 for rank 5', () => {
    expect(scoreChartPosition(5, ALBUM_CHART_POSITION_TIERS)).toBe(18);
  });
  it('returns 12 for rank 15', () => {
    expect(scoreChartPosition(15, ALBUM_CHART_POSITION_TIERS)).toBe(12);
  });
  it('returns 8 for rank 25', () => {
    expect(scoreChartPosition(25, ALBUM_CHART_POSITION_TIERS)).toBe(8);
  });
  it('returns 4 for rank 50', () => {
    expect(scoreChartPosition(50, ALBUM_CHART_POSITION_TIERS)).toBe(4);
  });
  it('returns 0 for rank 51 (out of tier)', () => {
    expect(scoreChartPosition(51, ALBUM_CHART_POSITION_TIERS)).toBe(0);
  });
  it('returns 0 for null', () => {
    expect(scoreChartPosition(null, ALBUM_CHART_POSITION_TIERS)).toBe(0);
  });
});

describe('DEFAULT_SONG_MOVEMENT', () => {
  it('debut bonus is 10', () => {
    expect(scoreChartMovement(null, true, DEFAULT_SONG_MOVEMENT)).toBe(10);
  });
  it('caps gain at 15', () => {
    expect(scoreChartMovement(20, false, DEFAULT_SONG_MOVEMENT)).toBe(15);
    expect(scoreChartMovement(15, false, DEFAULT_SONG_MOVEMENT)).toBe(15);
  });
  it('passes through gain under cap', () => {
    expect(scoreChartMovement(5, false, DEFAULT_SONG_MOVEMENT)).toBe(5);
  });
  it('caps drop at -10', () => {
    expect(scoreChartMovement(-15, false, DEFAULT_SONG_MOVEMENT)).toBe(-10);
    expect(scoreChartMovement(-10, false, DEFAULT_SONG_MOVEMENT)).toBe(-10);
  });
});

describe('DEFAULT_ALBUM_MOVEMENT', () => {
  it('debut bonus is 10', () => {
    expect(scoreChartMovement(null, true, DEFAULT_ALBUM_MOVEMENT)).toBe(10);
  });
  it('caps gain at 15', () => {
    expect(scoreChartMovement(20, false, DEFAULT_ALBUM_MOVEMENT)).toBe(15);
    expect(scoreChartMovement(15, false, DEFAULT_ALBUM_MOVEMENT)).toBe(15);
  });
  it('passes through gain under cap', () => {
    expect(scoreChartMovement(3, false, DEFAULT_ALBUM_MOVEMENT)).toBe(3);
  });
  it('caps drop at -10', () => {
    expect(scoreChartMovement(-15, false, DEFAULT_ALBUM_MOVEMENT)).toBe(-10);
    expect(scoreChartMovement(-10, false, DEFAULT_ALBUM_MOVEMENT)).toBe(-10);
  });
});

describe('scoreLongevity', () => {
  it('returns 0 for 0 consecutive weeks (not on chart)', () => {
    expect(scoreLongevity(0)).toBe(0);
  });
  it('returns 2 for 1 consecutive week', () => {
    expect(scoreLongevity(1)).toBe(2);
  });
  it('returns 6 for 3 consecutive weeks', () => {
    expect(scoreLongevity(3)).toBe(6);
  });
  it('caps at 12 for 6 consecutive weeks', () => {
    expect(scoreLongevity(6)).toBe(12);
  });
  it('still returns 12 for more than 6 weeks', () => {
    expect(scoreLongevity(10)).toBe(12);
  });
});
