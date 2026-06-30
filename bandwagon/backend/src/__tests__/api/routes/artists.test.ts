import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../db/prisma', () => ({
  prisma: {
    artist: { findMany: vi.fn(), findUnique: vi.fn() },
    genreStreamingTier: { findMany: vi.fn() },
    weeklyScore: { findUnique: vi.fn() },
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
  genreStreamingTier: { findMany: ReturnType<typeof vi.fn> };
  weeklyScore: { findUnique: ReturnType<typeof vi.fn> };
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
