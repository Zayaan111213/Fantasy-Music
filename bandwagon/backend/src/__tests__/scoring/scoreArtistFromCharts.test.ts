import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma', () => ({
  prisma: {
    chartEntry: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    albumChartEntry: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    weeklyScore: { upsert: vi.fn() },
    artist: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../db/prisma';
import { scoreArtistWeekFromCharts, scoreAllArtistsForWeek } from '../../scoring/engine';

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
  artist: { findMany: ReturnType<typeof vi.fn> };
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

  it('persists per-signal song + album breakdown so past weeks can show why an artist scored what they did', async () => {
    pm.chartEntry.findMany.mockResolvedValue([song(5)]);
    pm.chartEntry.findFirst.mockResolvedValue({ rank: 15 }); // +10 movement
    pm.albumChartEntry.findMany.mockResolvedValue([album(8)]);
    pm.albumChartEntry.findFirst.mockResolvedValue(null); // album debut

    await scoreArtistWeekFromCharts(ARTIST, WEEK, YEAR, WEEK_DATE);

    const c = capturedCreate();
    expect(c.songRank).toBe(5);
    expect(c.songTitle).toBe('Hit Song');
    expect(c.songPositionPoints).toBe(18);
    expect(c.songMovement).toBe(10);
    expect(c.songMovementPoints).toBe(10);
    expect(c.songIsDebut).toBe(false);
    expect(c.albumRank).toBe(8);
    expect(c.albumTitle).toBe('Album');
    expect(c.albumPositionPoints).toBe(18);
    expect(c.albumMovement).toBeNull();
    expect(c.albumMovementPoints).toBe(10);
    expect(c.albumIsDebut).toBe(true);
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

describe('split credits: shared songs score each artist independently', () => {
  it('scopes the prior-week movement lookup to the artist', async () => {
    pm.chartEntry.findMany.mockResolvedValue([song(5)]);
    pm.chartEntry.findFirst.mockResolvedValue({ rank: 20 });
    pm.chartEntry.count.mockResolvedValue(0);

    await scoreArtistWeekFromCharts(ARTIST, WEEK, YEAR, WEEK_DATE);

    // Joint credits duplicate rows per artist, so the same appleSongId exists
    // for several artists — the lookup must be scoped to this one.
    expect(pm.chartEntry.findFirst.mock.calls[0][0].where.artistId).toBe(ARTIST);
    expect(capturedCreate().songMovementPoints).toBe(15); // +15 cap on +15 climb
  });

  it('two artists sharing an appleSongId each get full position points and independent movement', async () => {
    // Both credited artists have a rank-1 row for the same song this week;
    // only artist-1 charted last week (rank 3), artist-2 is a debut.
    pm.chartEntry.findMany.mockResolvedValue([song(1)]);
    pm.chartEntry.findFirst.mockImplementation(async ({ where }: any) =>
      where.artistId === 'artist-1' ? { rank: 3 } : null,
    );
    pm.chartEntry.count.mockResolvedValue(0);

    await scoreArtistWeekFromCharts('artist-1', WEEK, YEAR, WEEK_DATE);
    await scoreArtistWeekFromCharts('artist-2', WEEK, YEAR, WEEK_DATE);

    const [first, second] = pm.weeklyScore.upsert.mock.calls.map((c) => c[0].create);
    expect(first.songPositionPoints).toBe(25); // full points, not shared
    expect(second.songPositionPoints).toBe(25);
    expect(first.songMovementPoints).toBe(2); // climbed 3 -> 1
    expect(first.songIsDebut).toBe(false);
    expect(second.songIsDebut).toBe(true); // debut for the artist with no prior row
    expect(second.songMovementPoints).toBe(10);
  });
});

describe('scoreAllArtistsForWeek', () => {
  it('excludes hidden (retired combined-credit) artists', async () => {
    pm.artist.findMany.mockResolvedValue([]);
    await scoreAllArtistsForWeek(WEEK, YEAR, WEEK_DATE);
    expect(pm.artist.findMany).toHaveBeenCalledWith({ where: { hiddenAt: null }, select: { id: true } });
  });

  it('scores every artist in the DB, including ones off both charts this week', async () => {
    // Bug: this used to only score artists returned by a distinct chartEntry/
    // albumChartEntry query for this weekDate, so an artist that fell off both
    // charts never got a fresh (zeroed) WeeklyScore row — every page reading
    // WeeklyScore directly kept showing its last stale total.
    pm.artist.findMany.mockResolvedValue([{ id: 'artist-1' }, { id: 'artist-2' }, { id: 'artist-3' }]);
    // Only artist-2 is actually on a chart this week; artist-1 and artist-3 are not.
    pm.chartEntry.findMany.mockImplementation(async ({ where }: any) =>
      where.artistId === 'artist-2' ? [song(10)] : [],
    );

    await scoreAllArtistsForWeek(WEEK, YEAR, WEEK_DATE);

    expect(pm.artist.findMany).toHaveBeenCalled();
    expect(pm.weeklyScore.upsert).toHaveBeenCalledTimes(3);
    const scoredArtistIds = pm.weeklyScore.upsert.mock.calls.map((call) => call[0].create.artistId);
    expect(scoredArtistIds).toEqual(['artist-1', 'artist-2', 'artist-3']);
  });
});
