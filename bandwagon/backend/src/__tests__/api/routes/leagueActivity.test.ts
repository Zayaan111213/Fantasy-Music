import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../db/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn() },
    team: { findMany: vi.fn(), findFirst: vi.fn() },
    leagueEvent: { findMany: vi.fn(), create: vi.fn() },
    notification: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../../api/middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = 'user-1';
    next();
  },
}));

// Prevent multer from doing anything
vi.mock('../../../api/middleware/upload', () => ({
  uploadTeamLogo: (_req: any, _res: any, next: any) => next(),
}));

import { prisma } from '../../../db/prisma';
import leagueRouter from '../../../api/routes/leagues';

const pm = prisma as unknown as {
  league: { findUnique: ReturnType<typeof vi.fn> };
  team: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  leagueEvent: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  notification: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};

const app = express();
app.use(express.json());
app.use('/leagues', leagueRouter);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /leagues/:id/activity', () => {
  it('returns 404 when the league does not exist', async () => {
    pm.league.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/leagues/bad-id/activity');
    expect(res.status).toBe(404);
  });

  it('returns 403 for a non-member', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1' });
    pm.team.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/leagues/l1/activity');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('You are not a member of this league');
  });

  it('merges league events and personal notifications newest-first with unseenCount', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1' });
    pm.team.findFirst.mockResolvedValue({ id: 't1' });
    pm.leagueEvent.findMany.mockResolvedValue([
      { id: 'e1', type: 'claim', message: 'Team A added X', meta: null, createdAt: new Date('2026-07-09T10:00:00Z') },
      { id: 'e2', type: 'week_result', message: 'Week 1 final', meta: null, createdAt: new Date('2026-07-07T10:00:00Z') },
    ]);
    pm.notification.findMany.mockResolvedValue([
      { id: 'n1', type: 'trade_proposed', message: 'Trade offer', seenAt: null, createdAt: new Date('2026-07-08T10:00:00Z') },
    ]);
    pm.notification.count.mockResolvedValue(1);

    const res = await request(app).get('/leagues/l1/activity');
    expect(res.status).toBe(200);
    expect(res.body.unseenCount).toBe(1);
    expect(res.body.items.map((i: any) => i.id)).toEqual(['e1', 'n1', 'e2']);
    expect(res.body.items[0].kind).toBe('league');
    expect(res.body.items[1].kind).toBe('personal');
    // Personal notifications are scoped to the requesting user and league
    expect(pm.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', leagueId: 'l1' } }),
    );
  });

  it('caps the merged feed at 100 items', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1' });
    pm.team.findFirst.mockResolvedValue({ id: 't1' });
    const events = Array.from({ length: 80 }, (_, i) => ({
      id: `e${i}`, type: 'claim', message: 'x', meta: null, createdAt: new Date(2026, 0, 1, 0, i),
    }));
    const personal = Array.from({ length: 80 }, (_, i) => ({
      id: `n${i}`, type: 'lineup_reminder', message: 'x', seenAt: null, createdAt: new Date(2026, 0, 1, 12, i),
    }));
    pm.leagueEvent.findMany.mockResolvedValue(events);
    pm.notification.findMany.mockResolvedValue(personal);
    pm.notification.count.mockResolvedValue(0);

    const res = await request(app).get('/leagues/l1/activity');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(100);
  });
});

describe('POST /leagues/:id/notifications/seen', () => {
  it('returns 403 for a non-member', async () => {
    pm.team.findFirst.mockResolvedValue(null);

    const res = await request(app).post('/leagues/l1/notifications/seen');
    expect(res.status).toBe(403);
    expect(pm.notification.updateMany).not.toHaveBeenCalled();
  });

  it("marks only the user's unseen league-scoped notifications", async () => {
    pm.team.findFirst.mockResolvedValue({ id: 't1' });
    pm.notification.updateMany.mockResolvedValue({ count: 3 });

    const res = await request(app).post('/leagues/l1/notifications/seen');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, count: 3 });
    expect(pm.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', leagueId: 'l1', seenAt: null },
      data: { seenAt: expect.any(Date) },
    });
  });
});
