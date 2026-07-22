import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// All mocks hoisted before any import that might trigger module execution

vi.mock('../../../db/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn() },
    team: { findMany: vi.fn() },
    artist: { findMany: vi.fn() },
    rosterSpot: { findMany: vi.fn() },
    trade: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    tradeItem: { findMany: vi.fn(), createMany: vi.fn() },
    tradeVeto: { create: vi.fn(), count: vi.fn() },
    notification: { createMany: vi.fn() },
    leagueEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../../api/middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = 'user-1';
    next();
  },
}));

// leagues.ts is pulled in transitively via trades/engine — stub multer
vi.mock('../../../api/middleware/upload', () => ({
  uploadTeamLogo: (_req: any, _res: any, next: any) => next(),
}));

import { prisma } from '../../../db/prisma';
import tradeRouter, { tradeVisibleToday } from '../../../api/routes/trades';

const pm = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
};

const app = express();
app.use(express.json());
app.use('/leagues', tradeRouter);

// 4-team league: user-1 owns team A.
const LEAGUE = {
  id: 'l1',
  status: 'active',
  currentWeek: 3,
  teams: [
    { id: 'A', name: 'Alpha', userId: 'user-1' },
    { id: 'B', name: 'Beta', userId: 'user-2' },
    { id: 'C', name: 'Gamma', userId: 'user-3' },
    { id: 'D', name: 'Delta', userId: 'user-4' },
  ],
};

const spot = (id: string, slot: string, artistId: string | null, genre = 'Pop') => ({
  id,
  slot,
  artistId,
  artist: artistId ? { id: artistId, primaryGenre: genre } : null,
});

beforeEach(() => {
  vi.clearAllMocks();
  pm.league.findUnique.mockResolvedValue(LEAGUE);
  pm.tradeItem.findMany.mockResolvedValue([]); // nothing locked by default
  pm.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
});

describe('GET /leagues/:id/trades', () => {
  it('403 for non-members', async () => {
    pm.league.findUnique.mockResolvedValue({ ...LEAGUE, teams: LEAGUE.teams.slice(1) });
    const res = await request(app).get('/leagues/l1/trades');
    expect(res.status).toBe(403);
  });

  it('maps trades with veto tallies and my vote', async () => {
    pm.trade.findMany.mockResolvedValue([{
      id: 't1', status: 'accepted', createdAt: new Date(), acceptedAt: new Date(), resolvedAt: null,
      proposerTeam: { id: 'B', name: 'Beta' }, receiverTeam: { id: 'C', name: 'Gamma' },
      items: [], vetoes: [{ teamId: 'A' }],
    }]);
    const res = await request(app).get('/leagues/l1/trades');
    expect(res.status).toBe(200);
    expect(res.body.myTeamId).toBe('A');
    expect(res.body.vetoesNeeded).toBe(2);
    expect(res.body.trades[0].vetoCount).toBe(1);
    expect(res.body.trades[0].myVetoed).toBe(true);
  });

  it('hides resolved trades from earlier days but keeps same-day ones and live ones', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const base = {
      createdAt: new Date(), acceptedAt: null,
      proposerTeam: { id: 'B', name: 'Beta' }, receiverTeam: { id: 'C', name: 'Gamma' },
      items: [], vetoes: [],
    };
    pm.trade.findMany.mockResolvedValue([
      { ...base, id: 't-pending', status: 'pending', resolvedAt: null },
      { ...base, id: 't-old-pending', status: 'pending', resolvedAt: null, createdAt: twoDaysAgo },
      { ...base, id: 't-rejected-today', status: 'rejected', resolvedAt: new Date() },
      { ...base, id: 't-rejected-old', status: 'rejected', resolvedAt: twoDaysAgo },
      { ...base, id: 't-vetoed-old', status: 'vetoed', resolvedAt: twoDaysAgo },
      { ...base, id: 't-executed-old', status: 'executed', resolvedAt: twoDaysAgo },
      { ...base, id: 't-cancelled-stale', status: 'cancelled', resolvedAt: null },
    ]);

    const res = await request(app).get('/leagues/l1/trades');
    expect(res.status).toBe(200);
    expect(res.body.trades.map((t: { id: string }) => t.id)).toEqual([
      't-pending',
      't-old-pending', // live trades never expire, whatever their age
      't-rejected-today',
    ]);
  });
});

describe('tradeVisibleToday', () => {
  it('uses Pacific calendar days, not 24h windows', () => {
    // Resolved Monday 23:00 PDT; viewed Tuesday 01:01 PDT — hidden after
    // barely two hours, because the PT day rolled over.
    const resolvedAt = new Date('2026-07-14T06:00:00Z');
    const now = new Date('2026-07-14T08:01:00Z');
    expect(tradeVisibleToday({ status: 'rejected', resolvedAt }, now)).toBe(false);
    // Same instant viewed later that Monday PT — still visible.
    expect(tradeVisibleToday({ status: 'rejected', resolvedAt }, new Date('2026-07-14T06:30:00Z'))).toBe(true);
  });

  it('never hides live trades', () => {
    const old = new Date('2020-01-01T00:00:00Z');
    expect(tradeVisibleToday({ status: 'pending', resolvedAt: old })).toBe(true);
    expect(tradeVisibleToday({ status: 'accepted', resolvedAt: old })).toBe(true);
  });
});

describe('POST /leagues/:id/trades (propose)', () => {
  const myRoster = [spot('sA1', 'Pop', 'x'), spot('sA2', 'Flex', 'x2')];
  const theirRoster = [spot('sB1', 'Pop', 'y')];

  function mockRosters() {
    pm.rosterSpot.findMany.mockImplementation(async (args: any) =>
      args.where.teamId === 'A' ? myRoster : theirRoster,
    );
  }

  it('rejects after the trade deadline', async () => {
    pm.league.findUnique.mockResolvedValue({ ...LEAGUE, currentWeek: 8 });
    const res = await request(app).post('/leagues/l1/trades').send({ toTeamId: 'B', give: ['x'], receive: ['y'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/deadline/);
  });

  it('rejects trading with yourself', async () => {
    const res = await request(app).post('/leagues/l1/trades').send({ toTeamId: 'A', give: ['x'], receive: ['y'] });
    expect(res.status).toBe(400);
  });

  it('rejects give artists not on my roster', async () => {
    mockRosters();
    const res = await request(app).post('/leagues/l1/trades').send({ toTeamId: 'B', give: ['nope'], receive: ['y'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own roster/);
  });

  it('rejects when the drop count is wrong for a net gain', async () => {
    // Full 9-slot roster: give 1, receive 2 → must drop exactly 1
    const full = Array.from({ length: 9 }, (_, i) => spot(`s${i}`, i === 0 ? 'Pop' : `Bench-${i}`, `a${i}`));
    pm.rosterSpot.findMany.mockImplementation(async (args: any) =>
      args.where.teamId === 'A' ? full : [spot('sB1', 'Pop', 'y'), spot('sB2', 'Flex', 'y2')],
    );
    const res = await request(app).post('/leagues/l1/trades').send({ toTeamId: 'B', give: ['a0'], receive: ['y', 'y2'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/drop exactly 1/);
  });

  it('rejects artists locked in an accepted trade', async () => {
    mockRosters();
    pm.tradeItem.findMany.mockResolvedValue([{ artistId: 'x' }]);
    const res = await request(app).post('/leagues/l1/trades').send({ toTeamId: 'B', give: ['x'], receive: ['y'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/locked/);
  });

  it('creates the trade, items, and receiver notification', async () => {
    mockRosters();
    pm.artist.findMany.mockImplementation(async (args: any) => {
      const ids: string[] = args.where.id.in;
      return ids.map((id) => ({ id, name: id.toUpperCase(), primaryGenre: 'Pop' }));
    });
    pm.trade.create.mockResolvedValue({ id: 't-new', status: 'pending' });

    const res = await request(app).post('/leagues/l1/trades').send({ toTeamId: 'B', give: ['x'], receive: ['y'] });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('t-new');
    expect(pm.tradeItem.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ artistId: 'x', fromTeamId: 'A', toTeamId: 'B' }),
        expect.objectContaining({ artistId: 'y', fromTeamId: 'B', toTeamId: 'A' }),
      ]),
    }));
    expect(pm.notification.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ userId: 'user-2', type: 'trade_proposed' })],
    }));
  });
});

describe('POST /leagues/:id/trades/:tradeId/accept', () => {
  // B proposed to A (user-1's team): B sends y, A sends x.
  const TRADE = {
    id: 't1',
    leagueId: 'l1',
    status: 'pending',
    proposerTeamId: 'B',
    receiverTeamId: 'A',
    proposerTeam: { id: 'B', name: 'Beta', userId: 'user-2' },
    items: [
      { artistId: 'y', fromTeamId: 'B', toTeamId: 'A', artist: { id: 'y', name: 'Y', primaryGenre: 'Pop' } },
      { artistId: 'x', fromTeamId: 'A', toTeamId: 'B', artist: { id: 'x', name: 'X', primaryGenre: 'Pop' } },
    ],
  };

  function mockRosters() {
    pm.rosterSpot.findMany.mockImplementation(async (args: any) => {
      if (args.where.teamId?.in) {
        return [
          { teamId: 'A', artistId: 'x' },
          { teamId: 'B', artistId: 'y' },
        ];
      }
      return args.where.teamId === 'A' ? [spot('sA1', 'Pop', 'x')] : [spot('sB1', 'Pop', 'y')];
    });
  }

  it('403 when not the receiving team', async () => {
    pm.trade.findFirst.mockResolvedValue({ ...TRADE, receiverTeamId: 'C' });
    const res = await request(app).post('/leagues/l1/trades/t1/accept').send({});
    expect(res.status).toBe(403);
  });

  it('400 when the trade is not pending', async () => {
    pm.trade.findFirst.mockResolvedValue({ ...TRADE, status: 'accepted' });
    const res = await request(app).post('/leagues/l1/trades/t1/accept').send({});
    expect(res.status).toBe(400);
  });

  it('auto-cancels a stale trade whose player left the roster', async () => {
    pm.trade.findFirst.mockResolvedValue(TRADE);
    pm.rosterSpot.findMany.mockResolvedValue([{ teamId: 'A', artistId: 'x' }]); // y missing from B
    pm.trade.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app).post('/leagues/l1/trades/t1/accept').send({});
    expect(res.status).toBe(409);
    expect(pm.trade.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'cancelled' }),
    }));
  });

  it('accepts and notifies the proposer plus every non-involved member', async () => {
    pm.trade.findFirst.mockResolvedValue(TRADE);
    mockRosters();
    pm.trade.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app).post('/leagues/l1/trades/t1/accept').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    const notifiedRows = pm.notification.createMany.mock.calls[0][0].data;
    const notified = notifiedRows.map((n: any) => n.userId);
    expect(notified).toContain('user-2'); // proposer
    expect(notified).toContain('user-3'); // non-involved
    expect(notified).toContain('user-4');
    expect(notified).not.toContain('user-1');
    // Every personal notification is league-scoped for the activity feed
    expect(notifiedRows.every((n: any) => n.leagueId === 'l1')).toBe(true);
    // And the acceptance lands on the league-wide feed
    expect(pm.leagueEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leagueId: 'l1', type: 'trade_accepted' }),
    }));
  });
});

describe('POST /leagues/:id/trades/:tradeId/veto', () => {
  // Trade between B and C; user-1's team A is non-involved.
  const TRADE = {
    id: 't1',
    leagueId: 'l1',
    status: 'accepted',
    proposerTeamId: 'B',
    receiverTeamId: 'C',
    proposerTeam: { id: 'B', name: 'Beta', userId: 'user-2' },
    receiverTeam: { id: 'C', name: 'Gamma', userId: 'user-3' },
  };

  it('403 for teams in the trade', async () => {
    pm.trade.findFirst.mockResolvedValue({ ...TRADE, proposerTeamId: 'A', proposerTeam: { id: 'A', name: 'Alpha', userId: 'user-1' } });
    const res = await request(app).post('/leagues/l1/trades/t1/veto').send({});
    expect(res.status).toBe(403);
  });

  it('400 for duplicate votes', async () => {
    pm.trade.findFirst.mockResolvedValue(TRADE);
    pm.tradeVeto.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    const res = await request(app).post('/leagues/l1/trades/t1/veto').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already voted/);
  });

  it('records a sub-threshold vote without vetoing', async () => {
    pm.trade.findFirst.mockResolvedValue(TRADE);
    pm.tradeVeto.create.mockResolvedValue({});
    pm.tradeVeto.count.mockResolvedValue(1);

    const res = await request(app).post('/leagues/l1/trades/t1/veto').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ vetoCount: 1, vetoesNeeded: 2, vetoed: false });
    expect(pm.trade.updateMany).not.toHaveBeenCalled();
  });

  it('flips the trade to vetoed on the unanimous final vote', async () => {
    pm.trade.findFirst.mockResolvedValue(TRADE);
    pm.tradeVeto.create.mockResolvedValue({});
    pm.tradeVeto.count.mockResolvedValue(2);
    pm.trade.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app).post('/leagues/l1/trades/t1/veto').send({});
    expect(res.status).toBe(200);
    expect(res.body.vetoed).toBe(true);
    expect(pm.trade.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1', status: 'accepted' },
      data: expect.objectContaining({ status: 'vetoed' }),
    }));
    expect(pm.notification.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({ type: 'trade_vetoed', leagueId: 'l1' })]),
    }));
    expect(pm.leagueEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leagueId: 'l1', type: 'trade_vetoed' }),
    }));
  });

  it('reports vetoed:false when finalize executed the trade in the gap before this vote committed', async () => {
    // Regression: the guarded updateMany (status: 'accepted') can match 0 rows
    // if finalize's execute already flipped the trade to 'executed' between our
    // status check and this update. The response used to hardcode vetoed:true
    // regardless, lying about what actually happened.
    pm.trade.findFirst.mockResolvedValue(TRADE);
    pm.tradeVeto.create.mockResolvedValue({});
    pm.tradeVeto.count.mockResolvedValue(2);
    pm.trade.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app).post('/leagues/l1/trades/t1/veto').send({});
    expect(res.status).toBe(200);
    expect(res.body.vetoed).toBe(false);
    expect(pm.notification.createMany).not.toHaveBeenCalled();
    expect(pm.leagueEvent.create).not.toHaveBeenCalled();
  });
});

describe('reject / cancel role guards', () => {
  it('403 when a non-receiver rejects', async () => {
    pm.trade.findFirst.mockResolvedValue({
      id: 't1', leagueId: 'l1', status: 'pending', proposerTeamId: 'A', receiverTeamId: 'B',
      proposerTeam: { userId: 'user-1' },
    });
    const res = await request(app).post('/leagues/l1/trades/t1/reject').send({});
    expect(res.status).toBe(403);
  });

  it('proposer can cancel a pending trade', async () => {
    pm.trade.findFirst.mockResolvedValue({
      id: 't1', leagueId: 'l1', status: 'pending', proposerTeamId: 'A', receiverTeamId: 'B',
      receiverTeam: { userId: 'user-2' },
    });
    pm.trade.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app).post('/leagues/l1/trades/t1/cancel').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });
});
