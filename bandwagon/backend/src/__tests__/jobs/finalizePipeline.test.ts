import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma', () => ({
  prisma: {
    rosterSpot:  { findMany: vi.fn() },
    weeklyScore: { findUnique: vi.fn() },
    // league.findMany must return [] by default so that main() (which runs at module
    // import time) iterates over an empty array and exits cleanly instead of throwing.
    league:  { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    matchup: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    team:    { update: vi.fn() },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../jobs/ingestCharts', () => ({
  getCurrentWeekDate: vi.fn().mockReturnValue(new Date('2026-06-17T19:00:00Z')),
}));

import { prisma } from '../../db/prisma';
import { resolveWinner, finalizeLeagueWeek } from '../../jobs/finalizePipeline';

const rosterFindMany = vi.mocked(prisma.rosterSpot.findMany);
const scoreFindUnique = vi.mocked(prisma.weeklyScore.findUnique);

beforeEach(() => {
  // Reset only the mocks that tests set up per-call, to clear any leftover once-queues.
  // Do NOT resetAllMocks() — that would wipe the factory defaults needed by main().
  vi.mocked(prisma.rosterSpot.findMany).mockReset();
  vi.mocked(prisma.weeklyScore.findUnique).mockReset();
});

describe('resolveWinner', () => {
  it('returns homeTeamId when home score is higher', async () => {
    expect(await resolveWinner('home', 'away', 100, 80, 1, 2026)).toBe('home');
    // No Prisma calls needed when scores differ
    expect(rosterFindMany).not.toHaveBeenCalled();
  });

  it('returns awayTeamId when away score is higher', async () => {
    expect(await resolveWinner('home', 'away', 70, 90, 1, 2026)).toBe('away');
    expect(rosterFindMany).not.toHaveBeenCalled();
  });

  it('uses tiebreaker when scores are equal — home best artist wins', async () => {
    rosterFindMany
      .mockResolvedValueOnce([{ artistId: 'a1' }] as never) // home
      .mockResolvedValueOnce([{ artistId: 'a2' }] as never); // away
    scoreFindUnique
      .mockResolvedValueOnce({ totalPoints: 50 } as never) // a1
      .mockResolvedValueOnce({ totalPoints: 30 } as never); // a2

    expect(await resolveWinner('home', 'away', 100, 100, 1, 2026)).toBe('home');
  });

  it('uses tiebreaker when scores are equal — away best artist wins', async () => {
    rosterFindMany
      .mockResolvedValueOnce([{ artistId: 'a1' }] as never)
      .mockResolvedValueOnce([{ artistId: 'a2' }] as never);
    scoreFindUnique
      .mockResolvedValueOnce({ totalPoints: 20 } as never)
      .mockResolvedValueOnce({ totalPoints: 45 } as never);

    expect(await resolveWinner('home', 'away', 100, 100, 1, 2026)).toBe('away');
  });

  it('returns null on a true tie (equal scores and equal best artist)', async () => {
    rosterFindMany
      .mockResolvedValueOnce([{ artistId: 'a1' }] as never)
      .mockResolvedValueOnce([{ artistId: 'a2' }] as never);
    scoreFindUnique
      .mockResolvedValueOnce({ totalPoints: 40 } as never)
      .mockResolvedValueOnce({ totalPoints: 40 } as never);

    expect(await resolveWinner('home', 'away', 100, 100, 1, 2026)).toBeNull();
  });

  it('counts missing weekly scores as 0 for tiebreaker', async () => {
    rosterFindMany
      .mockResolvedValueOnce([{ artistId: 'a1' }] as never)
      .mockResolvedValueOnce([{ artistId: 'a2' }] as never);
    scoreFindUnique
      .mockResolvedValueOnce(null as never) // a1 has no score
      .mockResolvedValueOnce({ totalPoints: 10 } as never);

    expect(await resolveWinner('home', 'away', 100, 100, 1, 2026)).toBe('away');
  });

  it('counts empty starter roster as 0 for tiebreaker', async () => {
    rosterFindMany
      .mockResolvedValueOnce([] as never)  // home has no starters
      .mockResolvedValueOnce([{ artistId: 'a2' }] as never);
    scoreFindUnique
      .mockResolvedValueOnce({ totalPoints: 15 } as never);

    expect(await resolveWinner('home', 'away', 100, 100, 1, 2026)).toBe('away');
  });
});

describe('finalizeLeagueWeek', () => {
  it('resolves winner and updates team wins/losses/pointsFor', async () => {
    vi.mocked(prisma.matchup.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.matchup.findMany).mockResolvedValueOnce([{
      id: 'm1', homeTeamId: 'h', awayTeamId: 'a',
      homeScore: 100, awayScore: 80,
    }] as never);

    await finalizeLeagueWeek('league1', 1, 2026);

    expect(prisma.matchup.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1' }, data: { winnerId: 'h' } })
    );
    expect(prisma.team.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'h' }, data: { wins: { increment: 1 } } })
    );
    expect(prisma.team.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a' }, data: { losses: { increment: 1 } } })
    );
    expect(prisma.team.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'h' }, data: { pointsFor: { increment: 100 } } })
    );
    expect(prisma.team.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a' }, data: { pointsFor: { increment: 80 } } })
    );
    expect(prisma.league.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'league1' }, data: { currentWeek: 2 } })
    );
  });

  it('skips all updates when already finalized (count = 0)', async () => {
    // matchup.updateMany default returns { count: 0 } — gate blocks processing
    vi.mocked(prisma.matchup.findMany).mockClear();
    vi.mocked(prisma.team.update).mockClear();

    await finalizeLeagueWeek('league1', 1, 2026);

    expect(prisma.matchup.findMany).not.toHaveBeenCalled();
    expect(prisma.team.update).not.toHaveBeenCalled();
  });
});
