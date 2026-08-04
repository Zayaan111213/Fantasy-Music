import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma', () => ({
  prisma: {
    rosterSpot: { findMany: vi.fn() },
    lineupSnapshot: { findMany: vi.fn(), createMany: vi.fn() },
  },
}));

import { prisma } from '../../db/prisma';
import { captureLineupSnapshot, applyLineupSnapshot } from '../../roster/snapshot';
import { weekDateForLeagueWeek } from '../../scoring/weeks';

const pm = prisma as unknown as {
  rosterSpot: { findMany: ReturnType<typeof vi.fn> };
  lineupSnapshot: { findMany: ReturnType<typeof vi.fn>; createMany: ReturnType<typeof vi.fn> };
};

// Drafted Wed 2026-06-03 PT → week 1 charts start Tue 2026-06-09.
const LEAGUE = { id: 'l1', draftTime: new Date('2026-06-04T02:00:00Z'), currentWeek: 6 };

beforeEach(() => {
  vi.clearAllMocks();
  pm.lineupSnapshot.createMany.mockResolvedValue({ count: 0 });
});

describe('captureLineupSnapshot', () => {
  it('writes one row per roster spot, skipping weeks already frozen', async () => {
    pm.rosterSpot.findMany.mockResolvedValue([
      { teamId: 't1', slot: 'Pop', artistId: 'a1' },
      { teamId: 't1', slot: 'Bench-1', artistId: null },
      { teamId: 't2', slot: 'Country', artistId: 'a2' },
    ]);
    pm.lineupSnapshot.createMany.mockResolvedValue({ count: 3 });

    const count = await captureLineupSnapshot(prisma as never, 'l1', 4);

    expect(count).toBe(3);
    const arg = pm.lineupSnapshot.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      { leagueId: 'l1', week: 4, teamId: 't1', slot: 'Pop', artistId: 'a1' },
      { leagueId: 'l1', week: 4, teamId: 't1', slot: 'Bench-1', artistId: null },
      { leagueId: 'l1', week: 4, teamId: 't2', slot: 'Country', artistId: 'a2' },
    ]);
    // Write-once: a re-run must never overwrite a frozen week with a roster
    // that has since changed.
    expect(arg.skipDuplicates).toBe(true);
  });

  it('is a no-op for a league with no roster spots', async () => {
    pm.rosterSpot.findMany.mockResolvedValue([]);

    expect(await captureLineupSnapshot(prisma as never, 'l1', 4)).toBe(0);
    expect(pm.lineupSnapshot.createMany).not.toHaveBeenCalled();
  });
});

describe('applyLineupSnapshot', () => {
  const matchup = () => ({
    week: 4,
    homeTeamId: 't1',
    awayTeamId: 't2',
    homeTeam: { rosterSpots: [{ id: 'live-home', slot: 'Pop', artistId: 'picked-up-later' }] },
    awayTeam: { rosterSpots: [{ id: 'live-away', slot: 'Pop', artistId: 'also-later' }] },
  });

  it('replaces both live rosters with the lineup frozen for that week', async () => {
    pm.lineupSnapshot.findMany.mockResolvedValue([
      { id: 's1', teamId: 't1', slot: 'Pop', artistId: 'a1', artist: { id: 'a1', name: 'Alpha' } },
      { id: 's2', teamId: 't2', slot: 'Pop', artistId: 'a2', artist: { id: 'a2', name: 'Beta' } },
    ]);

    const m = await applyLineupSnapshot(matchup(), LEAGUE);

    expect(m.homeTeam.rosterSpots).toEqual([
      { id: 's1', teamId: 't1', slot: 'Pop', artistId: 'a1', artist: { id: 'a1', name: 'Alpha' } },
    ]);
    expect(m.awayTeam.rosterSpots).toEqual([
      { id: 's2', teamId: 't2', slot: 'Pop', artistId: 'a2', artist: { id: 'a2', name: 'Beta' } },
    ]);
  });

  it('scopes the query to the matchup week and scores it against that chart week', async () => {
    pm.lineupSnapshot.findMany.mockResolvedValue([]);

    await applyLineupSnapshot(matchup(), LEAGUE);

    const arg = pm.lineupSnapshot.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ leagueId: 'l1', week: 4, teamId: { in: ['t1', 't2'] } });
    // Week 4 = 2026-06-09 + 3 weeks, independent of what week the league is on now.
    expect(arg.include.artist.include.weeklyScores.where).toEqual({
      weekDate: weekDateForLeagueWeek(LEAGUE, 4),
    });
    expect(weekDateForLeagueWeek(LEAGUE, 4).toISOString().slice(0, 10)).toBe('2026-06-30');
  });

  it('leaves the live roster untouched for weeks played before snapshotting existed', async () => {
    pm.lineupSnapshot.findMany.mockResolvedValue([]);

    const m = await applyLineupSnapshot(matchup(), LEAGUE);

    expect(m.homeTeam.rosterSpots).toEqual([{ id: 'live-home', slot: 'Pop', artistId: 'picked-up-later' }]);
    expect(m.awayTeam.rosterSpots).toEqual([{ id: 'live-away', slot: 'Pop', artistId: 'also-later' }]);
  });

  it('keeps a team on its live roster when only the opponent was snapshotted', async () => {
    pm.lineupSnapshot.findMany.mockResolvedValue([
      { id: 's1', teamId: 't1', slot: 'Pop', artistId: 'a1', artist: null },
    ]);

    const m = await applyLineupSnapshot(matchup(), LEAGUE);

    expect(m.homeTeam.rosterSpots).toHaveLength(1);
    expect(m.homeTeam.rosterSpots[0]).toMatchObject({ id: 's1' });
    expect(m.awayTeam.rosterSpots).toEqual([{ id: 'live-away', slot: 'Pop', artistId: 'also-later' }]);
  });
});
