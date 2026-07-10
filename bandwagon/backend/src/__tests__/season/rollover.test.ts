import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(), update: vi.fn() },
    team: { update: vi.fn() },
    matchup: { deleteMany: vi.fn() },
    draftPick: { deleteMany: vi.fn() },
    draftState: { deleteMany: vi.fn() },
    waiverClaim: { deleteMany: vi.fn() },
    trade: { deleteMany: vi.fn() },
    rosterSpot: { updateMany: vi.fn() },
    notification: { createMany: vi.fn() },
    leagueEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../db/prisma';
import { renewLeague } from '../../season/rollover';

const pm = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
};

const IN_2_HOURS = () => new Date(Date.now() + 2 * 60 * 60_000).toISOString();

const COMPLETE_LEAGUE = {
  id: 'league-1',
  name: 'Test League',
  commissionerId: 'user-1',
  status: 'complete',
  seasonYear: 2026,
  teams: [
    // Final standings: Alpha (8-2) > Beta (5-5) > Gamma (2-8)
    { id: 't-alpha', userId: 'user-1', name: 'Alpha', wins: 8, losses: 2, pointsFor: 900, createdAt: new Date('2026-01-01') },
    { id: 't-beta', userId: 'user-2', name: 'Beta', wins: 5, losses: 5, pointsFor: 700, createdAt: new Date('2026-01-02') },
    { id: 't-gamma', userId: 'user-3', name: 'Gamma', wins: 2, losses: 8, pointsFor: 500, createdAt: new Date('2026-01-03') },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  pm.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
});

describe('renewLeague', () => {
  it('404 when the league does not exist', async () => {
    pm.league.findUnique.mockResolvedValue(null);
    expect(await renewLeague('bad', 'user-1', IN_2_HOURS())).toMatchObject({ status: 404 });
  });

  it('403 for anyone but the commissioner', async () => {
    pm.league.findUnique.mockResolvedValue(COMPLETE_LEAGUE);
    expect(await renewLeague('league-1', 'user-2', IN_2_HOURS())).toMatchObject({ status: 403 });
  });

  it('400 unless the season is complete', async () => {
    pm.league.findUnique.mockResolvedValue({ ...COMPLETE_LEAGUE, status: 'active' });
    expect(await renewLeague('league-1', 'user-1', IN_2_HOURS())).toMatchObject({ status: 400 });
  });

  it('400 when the draft time is less than 1 hour away or invalid', async () => {
    pm.league.findUnique.mockResolvedValue(COMPLETE_LEAGUE);
    const in30min = new Date(Date.now() + 30 * 60_000).toISOString();
    expect(await renewLeague('league-1', 'user-1', in30min)).toMatchObject({ status: 400 });
    expect(await renewLeague('league-1', 'user-1', 'not-a-date')).toMatchObject({ status: 400 });
    expect(pm.$transaction).not.toHaveBeenCalled();
  });

  it('resets the league to pending with season data wiped and seasonYear bumped', async () => {
    pm.league.findUnique.mockResolvedValue(COMPLETE_LEAGUE);
    const draftISO = IN_2_HOURS();

    const result = await renewLeague('league-1', 'user-1', draftISO);

    expect(result).toMatchObject({ ok: true, seasonYear: 2027 });
    // Season data wiped
    expect(pm.matchup.deleteMany).toHaveBeenCalledWith({ where: { leagueId: 'league-1' } });
    expect(pm.draftPick.deleteMany).toHaveBeenCalledWith({ where: { leagueId: 'league-1' } });
    expect(pm.draftState.deleteMany).toHaveBeenCalledWith({ where: { leagueId: 'league-1' } });
    expect(pm.waiverClaim.deleteMany).toHaveBeenCalledWith({ where: { leagueId: 'league-1' } });
    expect(pm.trade.deleteMany).toHaveBeenCalledWith({ where: { leagueId: 'league-1' } });
    expect(pm.rosterSpot.updateMany).toHaveBeenCalledWith({
      where: { team: { leagueId: 'league-1' } },
      data: { artistId: null },
    });
    // League reset
    expect(pm.league.update).toHaveBeenCalledWith({
      where: { id: 'league-1' },
      data: { status: 'pending', draftTime: new Date(draftISO), currentWeek: 1, seasonYear: 2027 },
    });
  });

  it('sets next season draft order to reverse final standings (worst picks first)', async () => {
    pm.league.findUnique.mockResolvedValue(COMPLETE_LEAGUE);

    await renewLeague('league-1', 'user-1', IN_2_HOURS());

    // Gamma (worst) → position 1, Beta → 2, Alpha (champion) → 3
    expect(pm.team.update).toHaveBeenCalledWith({
      where: { id: 't-gamma' },
      data: expect.objectContaining({ wins: 0, losses: 0, pointsFor: 0, draftPosition: 1 }),
    });
    expect(pm.team.update).toHaveBeenCalledWith({
      where: { id: 't-beta' },
      data: expect.objectContaining({ draftPosition: 2 }),
    });
    expect(pm.team.update).toHaveBeenCalledWith({
      where: { id: 't-alpha' },
      data: expect.objectContaining({ draftPosition: 3 }),
    });
  });

  it('announces the renewal to the feed and every member', async () => {
    pm.league.findUnique.mockResolvedValue(COMPLETE_LEAGUE);

    await renewLeague('league-1', 'user-1', IN_2_HOURS());

    expect(pm.leagueEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leagueId: 'league-1',
        type: 'league_renewed',
        message: expect.stringContaining('renewed for 2027'),
      }),
    });
    const notified = pm.notification.createMany.mock.calls[0][0].data;
    expect(notified.map((n: { userId: string }) => n.userId).sort()).toEqual(['user-1', 'user-2', 'user-3']);
    expect(notified.every((n: { leagueId: string; type: string }) => n.leagueId === 'league-1' && n.type === 'league_renewed')).toBe(true);
  });
});
