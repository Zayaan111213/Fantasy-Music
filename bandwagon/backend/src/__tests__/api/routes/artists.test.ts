import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../db/prisma', () => ({
  prisma: {
    artist: { findMany: vi.fn(), findUnique: vi.fn() },
    league: { findUnique: vi.fn() },
    weeklyScore: { findUnique: vi.fn(), aggregate: vi.fn() },
    chartEntry: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    albumChartEntry: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    genreStreamingTier: { findMany: vi.fn() },
  },
}));

vi.mock('../../../api/middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = 'user-1';
    next();
  },
}));

import { prisma } from '../../../db/prisma';
import artistRouter from '../../../api/routes/artists';

const pm = prisma as unknown as {
  artist: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  league: { findUnique: ReturnType<typeof vi.fn> };
  weeklyScore: { findUnique: ReturnType<typeof vi.fn>; aggregate: ReturnType<typeof vi.fn> };
  chartEntry: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  albumChartEntry: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  genreStreamingTier: { findMany: ReturnType<typeof vi.fn> };
};

const app = express();
app.use(express.json());
app.use('/artists', artistRouter);

function makeArtist(i: number, genre = 'Pop', scores: number[] = [10]) {
  return {
    id: `artist-${i}`,
    name: `Artist ${String(i).padStart(4, '0')}`,
    primaryGenre: genre,
    imageUrl: null,
    weeklyScores: scores.map((totalPoints, idx) => ({ totalPoints, week: 5 - idx, seasonYear: 2026 })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /artists — list / search / filter
// ---------------------------------------------------------------------------

describe('GET /artists', () => {
  it('uses default limit of 40 when no limit param', async () => {
    pm.artist.findMany.mockResolvedValue([]);
    await request(app).get('/artists');
    expect(pm.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 40, skip: 0 }),
    );
  });

  it('honours limit param up to 5000 (draft-board use case)', async () => {
    pm.artist.findMany.mockResolvedValue([]);
    await request(app).get('/artists?limit=5000');
    expect(pm.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5000 }),
    );
  });

  it('caps limit at 5000 even when a higher value is requested', async () => {
    pm.artist.findMany.mockResolvedValue([]);
    await request(app).get('/artists?limit=9999');
    expect(pm.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5000 }),
    );
  });

  it('returns all 600 artists when limit=5000 (old 500 cap would have truncated)', async () => {
    // 600 exceeds the old hard cap of 500 — the route must now pass take:5000 to Prisma
    // so all DB results flow through unchanged.
    const artists = Array.from({ length: 600 }, (_, i) => makeArtist(i));
    pm.artist.findMany.mockResolvedValue(artists);
    const res = await request(app).get('/artists?limit=5000');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(600);
  });

  it('filters by genre when genre param is provided', async () => {
    pm.artist.findMany.mockResolvedValue([]);
    await request(app).get('/artists?genre=Pop');
    expect(pm.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ primaryGenre: 'Pop' }),
      }),
    );
  });

  it('does not apply genre filter when genre param is empty', async () => {
    pm.artist.findMany.mockResolvedValue([]);
    await request(app).get('/artists?genre=');
    const [[args]] = pm.artist.findMany.mock.calls;
    expect(args.where?.primaryGenre).toBeUndefined();
  });

  it('filters by name (case-insensitive) when q param is provided', async () => {
    pm.artist.findMany.mockResolvedValue([]);
    await request(app).get('/artists?q=Taylor');
    expect(pm.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: { contains: 'Taylor', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('does not apply name filter when q is empty', async () => {
    pm.artist.findMany.mockResolvedValue([]);
    await request(app).get('/artists?q=');
    const [[args]] = pm.artist.findMany.mock.calls;
    expect(args.where?.name).toBeUndefined();
  });

  it('supports genre + search together', async () => {
    pm.artist.findMany.mockResolvedValue([]);
    await request(app).get('/artists?genre=Country&q=morgan');
    expect(pm.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          primaryGenre: 'Country',
          name: { contains: 'morgan', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('derives lastWeekPoints from the most recent weekly score', async () => {
    pm.artist.findMany.mockResolvedValue([makeArtist(1, 'Pop', [30, 20, 10])]);
    const res = await request(app).get('/artists');
    expect(res.status).toBe(200);
    expect(res.body[0].lastWeekPoints).toBe(30);
  });

  it('derives avgLast5Points as a mean across all returned weekly scores', async () => {
    pm.artist.findMany.mockResolvedValue([makeArtist(1, 'Pop', [30, 20, 10])]);
    const res = await request(app).get('/artists');
    expect(res.body[0].avgLast5Points).toBeCloseTo(20); // (30+20+10)/3
  });

  it('strips raw weeklyScores from the response', async () => {
    pm.artist.findMany.mockResolvedValue([makeArtist(1)]);
    const res = await request(app).get('/artists');
    expect(res.body[0].weeklyScores).toBeUndefined();
  });

  it('returns 0 for both derived fields when artist has no weekly scores', async () => {
    pm.artist.findMany.mockResolvedValue([makeArtist(1, 'Pop', [])]);
    const res = await request(app).get('/artists');
    expect(res.body[0].lastWeekPoints).toBe(0);
    expect(res.body[0].avgLast5Points).toBe(0);
  });

  it('paginates via page param (page 2 skips first batch)', async () => {
    pm.artist.findMany.mockResolvedValue([]);
    await request(app).get('/artists?page=2&limit=40');
    expect(pm.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 40 }),
    );
  });
});

// ---------------------------------------------------------------------------
// GET /artists/:id — detail + score breakdown
// ---------------------------------------------------------------------------

describe('GET /artists/:id', () => {
  const WEEK_DATE = new Date('2026-07-01T00:00:00Z');
  const PRIOR_DATE = new Date('2026-06-24T00:00:00Z');

  // scoreLongevity(consecutiveWeeks) = min(max(consecutiveWeeks - 1, 0) * 2, 10).
  // `longevityPoints` here is the target output; we back it out into however many
  // consecutive prior-week chart.count calls must return non-zero to produce it.
  function setupArtist(opts: {
    longevityPoints?: number;
    songRank?: number | null;
    songPriorRank?: number | null;
    albumRank?: number | null;
    albumPriorRank?: number | null;
  } = {}) {
    const {
      longevityPoints = 0,
      songRank = 1,
      songPriorRank = 1,
      albumRank = 1,
      albumPriorRank = 1,
    } = opts;

    pm.genreStreamingTier.findMany.mockResolvedValue([]);

    pm.artist.findUnique.mockResolvedValue({
      id: 'drake', name: 'Drake', primaryGenre: 'R&B/Hip-Hop', imageUrl: null,
    });

    // Distinct-weekDate history discovery: for these tests the artist has
    // exactly one on-record chart week (WEEK_DATE), regardless of whether
    // that week's per-signal lookup below finds a song/album entry.
    pm.chartEntry.findMany.mockImplementation(async (args: any) =>
      args.distinct ? [{ weekDate: WEEK_DATE }] : (songRank !== null ? [{
        appleSongId: BigInt(111), songTitle: 'Janice STFU', chart: 'US', rank: songRank,
      }] : []),
    );
    pm.albumChartEntry.findMany.mockImplementation(async (args: any) =>
      args.distinct ? [{ weekDate: WEEK_DATE }] : (albumRank !== null ? [{
        appleAlbumId: BigInt(222), albumTitle: 'ICEMAN', chart: 'US', rank: albumRank,
      }] : []),
    );

    // findFirst is called twice for each signal: once for the route's own
    // "most recent chart entry ever" lookup (chartBreakdown block — no
    // `weekDate` in its where clause), and once for the prior-week lookup
    // (used both by that block and by the history computation for WEEK_DATE).
    pm.chartEntry.findFirst.mockImplementation(async (args: any) => {
      if (!args.where.weekDate) {
        return songRank !== null
          ? { appleSongId: BigInt(111), songTitle: 'Janice STFU', chart: 'US', rank: songRank, weekDate: WEEK_DATE }
          : null;
      }
      return songPriorRank !== null ? { appleSongId: BigInt(111), rank: songPriorRank, weekDate: PRIOR_DATE } : null;
    });
    pm.albumChartEntry.findFirst.mockImplementation(async (args: any) => {
      if (!args.where.weekDate) {
        return albumRank !== null
          ? { appleAlbumId: BigInt(222), albumTitle: 'ICEMAN', chart: 'US', rank: albumRank, weekDate: WEEK_DATE }
          : null;
      }
      return albumPriorRank !== null ? { appleAlbumId: BigInt(222), rank: albumPriorRank, weekDate: PRIOR_DATE } : null;
    });

    const priorWeeksOnChart = longevityPoints / 2;
    let call = 0;
    pm.chartEntry.count.mockImplementation(async () => (call++ < priorWeeksOnChart ? 1 : 0));
    pm.albumChartEntry.count.mockResolvedValue(0);
  }

  it('recomputes totalPoints from chartBreakdown — stale DB value is overridden', async () => {
    // Song and album both unchanged at #1 (movement 0) → total is 50, not some stale figure.
    setupArtist({ songRank: 1, songPriorRank: 1, albumRank: 1, albumPriorRank: 1 });

    const res = await request(app).get('/artists/drake');
    expect(res.status).toBe(200);
    // Song position #1 = 25, movement 0 = 0; album position #1 = 25, movement 0 = 0; longevity = 0
    expect(res.body.weeklyScores[0].totalPoints).toBe(50);
  });

  it('subtracts a negative movement penalty from totalPoints instead of flooring it at 0', async () => {
    // Song dropped from rank 5 to rank 20 → movement -15, capped at maxDrop -10.
    // Album unchanged at #1. Total must reflect the real penalty, not floor it at 0.
    setupArtist({ songRank: 20, songPriorRank: 5, albumRank: 1, albumPriorRank: 1 });

    const res = await request(app).get('/artists/drake');
    expect(res.status).toBe(200);
    expect(res.body.chartBreakdown.song.movementPoints).toBe(-10);
    // song position (rank 20 → 12) + song movement (-10) + album position (25) + album movement (0) + longevity (0)
    expect(res.body.weeklyScores[0].totalPoints).toBe(27);
  });

  it('applies the fell-off-chart penalty when the artist charted last week but not this week', async () => {
    // No song/album entry this week → chartBreakdown is null, longevity resets,
    // and the fell-off penalty (-10 per chart charted last week) applies.
    setupArtist({ longevityPoints: 2, songRank: null, albumRank: null });

    const res = await request(app).get('/artists/drake');
    expect(res.status).toBe(200);
    expect(res.body.chartBreakdown).toBeNull();
    expect(res.body.weeklyScores[0].longevityPoints).toBe(0);
    expect(res.body.weeklyScores[0].totalPoints).toBe(-10);
  });

  it('totalPoints includes debut movement bonus when artist has no prior chart entry', async () => {
    // No prior song or album entry → both are debuts → +10 each
    setupArtist({ songRank: 1, songPriorRank: null, albumRank: 1, albumPriorRank: null });

    const res = await request(app).get('/artists/drake');
    // Song position 25 + debut +10; album position 25 + debut +10 = 70
    expect(res.body.weeklyScores[0].totalPoints).toBe(70);
  });

  it('totalPoints includes longevity computed from consecutive charting weeks', async () => {
    // Both at #1, no movement, longevity = 6 (4 consecutive weeks: 1 + 3 prior)
    setupArtist({ longevityPoints: 6, songRank: 1, songPriorRank: 1, albumRank: 1, albumPriorRank: 1 });

    const res = await request(app).get('/artists/drake');
    // 25 + 0 + 25 + 0 + 6 = 56
    expect(res.body.weeklyScores[0].totalPoints).toBe(56);
  });

  it('returns chartBreakdown with correct rank, title, and points', async () => {
    setupArtist({ songRank: 5, songPriorRank: 10, albumRank: null });

    const res = await request(app).get('/artists/drake');
    expect(res.status).toBe(200);
    const bd = res.body.chartBreakdown;
    expect(bd.song.rank).toBe(5);
    expect(bd.song.title).toBe('Janice STFU');
    expect(bd.song.positionPoints).toBe(18); // rank 5 → tier 2–10 = 18
    expect(bd.song.movement).toBe(5);        // prior 10 − current 5 = +5
    expect(bd.song.movementPoints).toBe(5);  // +5 positions
    expect(bd.album).toBeNull();
  });

  it('returns up to the last 10 real chart weeks, independent of any league week counter', async () => {
    // 12 distinct weekDates on record — the response must cap at 10 and use
    // the most recent ones, not whatever a league's own currentWeek happens
    // to be (there is no leagueId on this request at all).
    const weekDates = Array.from({ length: 12 }, (_, i) => new Date(WEEK_DATE.getTime() - i * 7 * 24 * 60 * 60 * 1000));
    pm.genreStreamingTier.findMany.mockResolvedValue([]);
    pm.artist.findUnique.mockResolvedValue({ id: 'drake', name: 'Drake', primaryGenre: 'R&B/Hip-Hop', imageUrl: null });
    pm.chartEntry.findMany.mockImplementation(async (args: any) =>
      args.distinct ? weekDates.map((weekDate) => ({ weekDate })) : [{ appleSongId: BigInt(1), songTitle: 'X', chart: 'US', rank: 10 }],
    );
    pm.albumChartEntry.findMany.mockImplementation(async (args: any) => (args.distinct ? [] : []));
    pm.chartEntry.findFirst.mockResolvedValue(null);
    pm.albumChartEntry.findFirst.mockResolvedValue(null);
    pm.chartEntry.count.mockResolvedValue(0);
    pm.albumChartEntry.count.mockResolvedValue(0);

    const res = await request(app).get('/artists/drake');
    expect(res.status).toBe(200);
    expect(res.body.weeklyScores).toHaveLength(10);
    // Most recent week first, numbered so the latest has the highest "week" value.
    expect(res.body.weeklyScores[0].week).toBe(10);
    expect(res.body.weeklyScores[9].week).toBe(1);
  });

  it('returns fewer than 10 weeks when the artist has charted for fewer weeks', async () => {
    pm.genreStreamingTier.findMany.mockResolvedValue([]);
    pm.artist.findUnique.mockResolvedValue({ id: 'newcomer', name: 'Newcomer', primaryGenre: 'Pop', imageUrl: null });
    pm.chartEntry.findMany.mockImplementation(async (args: any) =>
      args.distinct ? [{ weekDate: WEEK_DATE }, { weekDate: PRIOR_DATE }] : [{ appleSongId: BigInt(1), songTitle: 'Debut', chart: 'US', rank: 40 }],
    );
    pm.albumChartEntry.findMany.mockResolvedValue([]);
    pm.chartEntry.findFirst.mockResolvedValue(null);
    pm.albumChartEntry.findFirst.mockResolvedValue(null);
    pm.chartEntry.count.mockResolvedValue(0);
    pm.albumChartEntry.count.mockResolvedValue(0);

    const res = await request(app).get('/artists/newcomer');
    expect(res.status).toBe(200);
    expect(res.body.weeklyScores).toHaveLength(2);
  });

  it('returns 404 when artist not found', async () => {
    pm.artist.findUnique.mockResolvedValue(null);
    pm.chartEntry.findFirst.mockResolvedValue(null);
    pm.albumChartEntry.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/artists/unknown');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Artist not found');
  });
});
