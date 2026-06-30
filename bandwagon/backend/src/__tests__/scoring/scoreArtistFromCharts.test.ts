import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma', () => ({
  prisma: {
    chartEntry: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    albumChartEntry: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    weeklyScore: { upsert: vi.fn() },
  },
}));

import { prisma } from '../../db/prisma';
import { scoreArtistWeekFromCharts } from '../../scoring/engine';

const pm = prisma as unknown as {
  chartEntry: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  albumChartEntry: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  weeklyScore: { upsert: ReturnType<typeof vi.fn> };
};

const WEEK_DATE = new Date('2026-06-17T00:00:00Z');
const ARTIST = 'artist-1';
const WEEK = 2;
const YEAR = 2026;

function song(rank: number, appleSongId = BigInt(100)) {
  return { rank, appleSongId, chart: 'US', songTitle: 'Hit Song' };
}

function album(rank: number, appleAlbumId = BigInt(200)) {
  return { rank, appleAlbumId, chart: 'US', albumTitle: 'Album' };
}

function capturedCreate() {
  return pm.weeklyScore.upsert.mock.calls[0]?.[0]?.create;
}

beforeEach(() => {
  vi.clearAllMocks();
  pm.weeklyScore.upsert.mockResolvedValue({} as never);
  // Safe defaults so tests only need to override what they care about
  pm.chartEntry.findMany.mockResolvedValue([]);
  pm.albumChartEntry.findMany.mockResolvedValue([]);
  pm.chartEntry.count.mockResolvedValue(0);
  pm.albumChartEntry.count.mockResolvedValue(0);
});

describe('scoreArtistWeekFromCharts', () => {
  it('scores 0 and sets dataMissing when not on any chart', async () => {
    await scoreArtistWeekFromCharts(ARTIST, WEEK, YEAR, WEEK_DATE);

    const c = capturedCreate();
    expect(c.totalPoints).toBe(0);
    expect(c.chartPositionPoints).toBe(0);
    expect(c.chartMovementPoints).toBe(0);
    expect(c.longevityPoints).toBe(0);
    expect(c.dataMissing).toBe('charts');
  });

  it('scores song debut: rank 5 (18 pts) + debut bonus (10) + first-week longevity (0) = 28', async () => {
    pm.chartEntry.findMany.mockResolvedValue([song(5)]);
    pm.chartEntry.findFirst.mockResolvedValue(null); // debut — no prior week entry

    await scoreArtistWeekFromCharts(ARTIST, WEEK, YEAR, WEEK_DATE);

    const c = capturedCreate();
    expect(c.chartPositionPoints).toBe(18);
    expect(c.chartMovementPoints).toBe(10);
    expect(c.longevityPoints).toBe(0);
    expect(c.totalPoints).toBe(28);
    expect(c.chartMovement).toBeNull(); // null when debut
    expect(c.bestChartPosition).toBe(5);
    expect(c.dataMissing).toBeNull();
  });

  it('scores movement gain: rank 5, prior rank 15 → +10 movement', async () => {
    pm.chartEntry.findMany.mockResolvedValue([song(5)]);
    pm.chartEntry.findFirst.mockResolvedValue({ rank: 15 });

    await scoreArtistWeekFromCharts(ARTIST, WEEK, YEAR, WEEK_DATE);

    const c = capturedCreate();
    expect(c.chartMovement).toBe(10); // 15 - 5 = +10
    expect(c.chartMovementPoints).toBe(10);
    expect(c.chartPositionPoints).toBe(18);
    expect(c.totalPoints).toBe(28);
  });

  it('caps positive movement at +15: rank 1, prior rank 50 → 49 spots gained, capped', async () => {
    pm.chartEntry.findMany.mockResolvedValue([song(1)]);
    pm.chartEntry.findFirst.mockResolvedValue({ rank: 50 });

    await scoreArtistWeekFromCharts(ARTIST, WEEK, YEAR, WEEK_DATE);

    const c = capturedCreate();
    expect(c.chartMovementPoints).toBe(15); // capped
    expect(c.chartPositionPoints).toBe(25); // rank 1 = 25 pts
    expect(c.totalPoints).toBe(40);
  });

  it('caps negative movement at -10: rank 20, prior rank 5 → dropped 15, capped at -10', async () => {
    pm.chartEntry.findMany.mockResolvedValue([song(20)]);
    pm.chartEntry.findFirst.mockResolvedValue({ rank: 5 });

    await scoreArtistWeekFromCharts(ARTIST, WEEK, YEAR, WEEK_DATE);

    const c = capturedCreate();
    expect(c.chartMovementPoints).toBe(-10); // capped at maxDrop
    expect(c.chartPositionPoints).toBe(12);  // rank 20, tier 11-25 = 12 pts
    expect(c.totalPoints).toBe(2);
  });

  it('scores album only: rank 8 debut → 18 (position) + 10 (debut) = 28', async () => {
    pm.albumChartEntry.findMany.mockResolvedValue([album(8)]);
    pm.albumChartEntry.findFirst.mockResolvedValue(null); // album debut

    await scoreArtistWeekFromCharts(ARTIST, WEEK, YEAR, WEEK_DATE);

    const c = capturedCreate();
    expect(c.chartPositionPoints).toBe(18); // album rank 8, tier 2-10 = 18
    expect(c.chartMovementPoints).toBe(10); // debut
    expect(c.longevityPoints).toBe(0);
    expect(c.totalPoints).toBe(28);
    expect(c.bestChartPosition).toBe(8); // comes from album when no song
  });

  it('combines song + album: both rank 5 debut → 18+18 position + 10+10 movement = 56', async () => {
    pm.chartEntry.findMany.mockResolvedValue([song(5)]);
    pm.chartEntry.findFirst.mockResolvedValue(null);
    pm.albumChartEntry.findMany.mockResolvedValue([album(5)]);
    pm.albumChartEntry.findFirst.mockResolvedValue(null);

    await scoreArtistWeekFromCharts(ARTIST, WEEK, YEAR, WEEK_DATE);

    const c = capturedCreate();
    expect(c.chartPositionPoints).toBe(36); // 18 + 18
    expect(c.chartMovementPoints).toBe(20); // 10 + 10
    expect(c.totalPoints).toBe(56);
  });

  it('caps longevity at +10 after 6 consecutive weeks on chart', async () => {
    pm.chartEntry.findMany.mockResolvedValue([song(10)]);
    pm.chartEntry.findFirst.mockResolvedValue(null);
    // All 5 prior-week count queries return 1 → consecutiveWeeks = 1 + 5 = 6
    pm.chartEntry.count.mockResolvedValue(1);

    await scoreArtistWeekFromCharts(ARTIST, WEEK, YEAR, WEEK_DATE);

    const c = capturedCreate();
    // scoreLongevity(6) = min((6-1)*2, 10) = 10
    expect(c.longevityPoints).toBe(10);
    expect(c.totalPoints).toBe(18 + 10 + 10); // pos + debut + longevity
  });

  it('stops longevity count when a gap week is found (2 prior + gap = week 3)', async () => {
    pm.chartEntry.findMany.mockResolvedValue([song(10)]);
    pm.chartEntry.findFirst.mockResolvedValue(null);
    // Prior week 1: on chart; prior week 2: on chart; prior week 3: off chart (gap)
    pm.chartEntry.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0); // gap — loop breaks here

    await scoreArtistWeekFromCharts(ARTIST, WEEK, YEAR, WEEK_DATE);

    const c = capturedCreate();
    // consecutiveWeeks = 1 + 2 = 3 → scoreLongevity(3) = (3-1)*2 = 4
    expect(c.longevityPoints).toBe(4);
  });

  it('uses the best-ranked song when artist has multiple chart entries', async () => {
    // DB returns entries already sorted asc by rank (rank 5 first)
    pm.chartEntry.findMany.mockResolvedValue([song(5, BigInt(100)), song(20, BigInt(101))]);
    pm.chartEntry.findFirst.mockResolvedValue(null); // debut

    await scoreArtistWeekFromCharts(ARTIST, WEEK, YEAR, WEEK_DATE);

    const c = capturedCreate();
    // Should use rank 5 (18 pts), not rank 20 (12 pts)
    expect(c.chartPositionPoints).toBe(18);
    expect(c.bestChartPosition).toBe(5);
  });
});
