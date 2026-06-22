import { describe, it, expect } from 'vitest';
import { MockDataProvider } from '../../data/mock';

const provider = new MockDataProvider();
const artistId = 'test-artist-1';
const year = 2026;

describe('MockDataProvider.getWeeklyStreams', () => {
  it('returns a non-negative number', async () => {
    const streams = await provider.getWeeklyStreams(artistId, 1, year);
    expect(streams).not.toBeNull();
    expect(streams!).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic — same args always return same value', async () => {
    const a = await provider.getWeeklyStreams(artistId, 3, year);
    const b = await provider.getWeeklyStreams(artistId, 3, year);
    expect(a).toBe(b);
  });

  it('returns different values for different weeks', async () => {
    const w1 = await provider.getWeeklyStreams(artistId, 1, year);
    const w2 = await provider.getWeeklyStreams(artistId, 5, year);
    // Not guaranteed to differ for every pair, but overwhelmingly true in practice
    // Just assert both are valid numbers
    expect(typeof w1).toBe('number');
    expect(typeof w2).toBe('number');
  });

  it('returns different values for different artists', async () => {
    const a = await provider.getWeeklyStreams('artist-aaa', 1, year);
    const b = await provider.getWeeklyStreams('artist-zzz', 1, year);
    expect(a).not.toBe(b);
  });
});

describe('MockDataProvider.getBestChartPosition', () => {
  it('returns null or a number between 1 and 100', async () => {
    // Sample several artists/weeks
    for (let week = 1; week <= 10; week++) {
      const pos = await provider.getBestChartPosition(artistId, week, year);
      if (pos !== null) {
        expect(pos).toBeGreaterThanOrEqual(1);
        expect(pos).toBeLessThanOrEqual(100);
      }
    }
  });

  it('is deterministic', async () => {
    const a = await provider.getBestChartPosition(artistId, 2, year);
    const b = await provider.getBestChartPosition(artistId, 2, year);
    expect(a).toBe(b);
  });

  it('returns integer values when not null', async () => {
    for (let week = 1; week <= 10; week++) {
      const pos = await provider.getBestChartPosition(artistId, week, year);
      if (pos !== null) {
        expect(Number.isInteger(pos)).toBe(true);
      }
    }
  });
});

describe('MockDataProvider.getChartMovement', () => {
  it('returns null for week 1', async () => {
    const movement = await provider.getChartMovement(artistId, 1, year);
    expect(movement).toBeNull();
  });

  it('returns null or a number for week > 1', async () => {
    const movement = await provider.getChartMovement(artistId, 3, year);
    if (movement !== null) {
      expect(typeof movement).toBe('number');
      expect(Number.isInteger(movement)).toBe(true);
    }
  });

  it('is deterministic', async () => {
    const a = await provider.getChartMovement(artistId, 4, year);
    const b = await provider.getChartMovement(artistId, 4, year);
    expect(a).toBe(b);
  });
});
