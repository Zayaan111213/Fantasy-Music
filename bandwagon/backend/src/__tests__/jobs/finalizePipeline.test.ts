import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma', () => ({
  prisma: {
    rosterSpot:  { findMany: vi.fn() },
    trade:       { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    tradeItem:   { findMany: vi.fn().mockResolvedValue([]) },
    weeklyScore: { findUnique: vi.fn() },
    // league.findMany must return [] by default so that main() (which runs at module
    // import time) iterates over an empty array and exits cleanly instead of throwing.
    league: {
      findMany:   vi.fn().mockResolvedValue([]),
      update:     vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    matchup: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany:   vi.fn().mockResolvedValue([]),
      // Next-week matchups exist by default, so advanceSeason moves the week
      // forward and ensurePlayoffMatchups no-ops.
      findFirst:  vi.fn().mockResolvedValue({ id: 'm-next' }),
      update:     vi.fn(),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    team:    { update: vi.fn(), findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    notification: { createMany: vi.fn() },
    leagueEvent:  { create: vi.fn() },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../jobs/ingestCharts', () => ({
  getCurrentWeekDate: vi.fn().mockReturnValue(new Date('2026-06-17T19:00:00Z')),
}));

vi.mock('../../waivers/engine', () => ({
  resolveWaivers: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../../db/prisma';
import { resolveWaivers } from '../../waivers/engine';
import { resolveWinner, finalizeLeagueWeek, firstScoringTuesdayPT, runFinalizePipeline } from '../../jobs/finalizePipeline';

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
    expect(await resolveWinner('home', 'away', 100, 80, new Date('2026-06-17T00:00:00Z'))).toBe('home');
    // No Prisma calls needed when scores differ
    expect(rosterFindMany).not.toHaveBeenCalled();
  });

  it('returns awayTeamId when away score is higher', async () => {
    expect(await resolveWinner('home', 'away', 70, 90, new Date('2026-06-17T00:00:00Z'))).toBe('away');
    expect(rosterFindMany).not.toHaveBeenCalled();
  });

  it('uses tiebreaker when scores are equal — home best artist wins', async () => {
    rosterFindMany
      .mockResolvedValueOnce([{ artistId: 'a1' }] as never) // home
      .mockResolvedValueOnce([{ artistId: 'a2' }] as never); // away
    scoreFindUnique
      .mockResolvedValueOnce({ totalPoints: 50 } as never) // a1
      .mockResolvedValueOnce({ totalPoints: 30 } as never); // a2

    expect(await resolveWinner('home', 'away', 100, 100, new Date('2026-06-17T00:00:00Z'))).toBe('home');
  });

  it('uses tiebreaker when scores are equal — away best artist wins', async () => {
    rosterFindMany
      .mockResolvedValueOnce([{ artistId: 'a1' }] as never)
      .mockResolvedValueOnce([{ artistId: 'a2' }] as never);
    scoreFindUnique
      .mockResolvedValueOnce({ totalPoints: 20 } as never)
      .mockResolvedValueOnce({ totalPoints: 45 } as never);

    expect(await resolveWinner('home', 'away', 100, 100, new Date('2026-06-17T00:00:00Z'))).toBe('away');
  });

  it('returns null on a true tie (equal scores and equal best artist)', async () => {
    rosterFindMany
      .mockResolvedValueOnce([{ artistId: 'a1' }] as never)
      .mockResolvedValueOnce([{ artistId: 'a2' }] as never);
    scoreFindUnique
      .mockResolvedValueOnce({ totalPoints: 40 } as never)
      .mockResolvedValueOnce({ totalPoints: 40 } as never);

    expect(await resolveWinner('home', 'away', 100, 100, new Date('2026-06-17T00:00:00Z'))).toBeNull();
  });

  it('counts missing weekly scores as 0 for tiebreaker', async () => {
    rosterFindMany
      .mockResolvedValueOnce([{ artistId: 'a1' }] as never)
      .mockResolvedValueOnce([{ artistId: 'a2' }] as never);
    scoreFindUnique
      .mockResolvedValueOnce(null as never) // a1 has no score
      .mockResolvedValueOnce({ totalPoints: 10 } as never);

    expect(await resolveWinner('home', 'away', 100, 100, new Date('2026-06-17T00:00:00Z'))).toBe('away');
  });

  it('counts empty starter roster as 0 for tiebreaker', async () => {
    rosterFindMany
      .mockResolvedValueOnce([] as never)  // home has no starters
      .mockResolvedValueOnce([{ artistId: 'a2' }] as never);
    scoreFindUnique
      .mockResolvedValueOnce({ totalPoints: 15 } as never);

    expect(await resolveWinner('home', 'away', 100, 100, new Date('2026-06-17T00:00:00Z'))).toBe('away');
  });
});

describe('finalizeLeagueWeek', () => {
  it('resolves winner and updates team wins/losses/pointsFor', async () => {
    vi.mocked(prisma.matchup.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.matchup.findMany).mockResolvedValueOnce([{
      id: 'm1', homeTeamId: 'h', awayTeamId: 'a',
      homeScore: 100, awayScore: 80,
      matchupType: 'regular', homeSeed: null, awaySeed: null,
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
    expect(prisma.league.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'league1', currentWeek: { lt: 2 } },
        data: { currentWeek: 2 },
      })
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

  it('playoff dead tie falls back to the higher seed and skips team stat updates', async () => {
    vi.mocked(prisma.team.update).mockClear();
    vi.mocked(prisma.matchup.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.matchup.findMany).mockResolvedValueOnce([{
      id: 'm-semi', homeTeamId: 'h', awayTeamId: 'a',
      homeScore: 100, awayScore: 100,
      matchupType: 'semifinal', homeSeed: 2, awaySeed: 3,
    }] as never);
    // Equal best-artist tiebreaker: both rosters empty → 0 vs 0 → true tie
    rosterFindMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    await finalizeLeagueWeek('league1', 11, 2026);

    expect(prisma.matchup.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm-semi' }, data: { winnerId: 'h' } })
    );
    // Playoff games never touch wins/losses/pointsFor
    expect(prisma.team.update).not.toHaveBeenCalled();
  });

  it('marks the league complete after the finals week', async () => {
    vi.mocked(prisma.matchup.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.matchup.findMany).mockResolvedValueOnce([{
      id: 'm-final', homeTeamId: 'h', awayTeamId: 'a',
      homeScore: 120, awayScore: 90,
      matchupType: 'championship', homeSeed: 1, awaySeed: 2,
    }] as never);

    await finalizeLeagueWeek('league1', 12, 2026);

    expect(prisma.league.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'league1', status: { not: 'complete' } },
        data: { status: 'complete' },
      })
    );
  });

  it('emits a week_result feed event per matchup with team names', async () => {
    vi.mocked(prisma.leagueEvent.create).mockClear();
    vi.mocked(prisma.matchup.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.team.findMany).mockResolvedValueOnce([
      { id: 'h', name: 'Heavy Hitters' },
      { id: 'a', name: 'Airwaves' },
    ] as never);
    vi.mocked(prisma.matchup.findMany).mockResolvedValueOnce([{
      id: 'm1', homeTeamId: 'h', awayTeamId: 'a',
      homeScore: 100, awayScore: 80,
      matchupType: 'regular', homeSeed: null, awaySeed: null,
    }] as never);

    await finalizeLeagueWeek('league1', 1, 2026);

    expect(prisma.leagueEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leagueId: 'league1',
        type: 'week_result',
        message: 'Week 1 final: Heavy Hitters 100 - Airwaves 80 · Heavy Hitters wins',
      }),
    });
  });

  it('emits no feed events on the already-finalized (count = 0) path', async () => {
    vi.mocked(prisma.leagueEvent.create).mockClear();
    // matchup.updateMany default returns { count: 0 }
    await finalizeLeagueWeek('league1', 1, 2026);
    expect(prisma.leagueEvent.create).not.toHaveBeenCalled();
  });

  it('resolves waivers on the normal finalize path', async () => {
    vi.mocked(resolveWaivers).mockClear();
    vi.mocked(prisma.matchup.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.matchup.findMany).mockResolvedValueOnce([] as never);

    await finalizeLeagueWeek('league1', 1, 2026);

    expect(resolveWaivers).toHaveBeenCalledWith('league1');
  });

  it('resolves waivers on the count=0 crash-recovery path too', async () => {
    vi.mocked(resolveWaivers).mockClear();
    // matchup.updateMany default returns { count: 0 }
    await finalizeLeagueWeek('league1', 1, 2026);

    expect(resolveWaivers).toHaveBeenCalledWith('league1');
  });

  it('sends league-scoped lineup reminders to every member when the week advances', async () => {
    vi.mocked(prisma.notification.createMany).mockClear();
    vi.mocked(prisma.matchup.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.matchup.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.team.findMany)
      .mockResolvedValueOnce([] as never) // recap name lookup
      .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }] as never); // members

    await finalizeLeagueWeek('league1', 1, 2026);

    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: 'u1', leagueId: 'league1', type: 'lineup_reminder' }),
        expect.objectContaining({ userId: 'u2', leagueId: 'league1', type: 'lineup_reminder' }),
      ],
    });
  });

  it('skips lineup reminders when the week does not advance (monotonic guard)', async () => {
    vi.mocked(prisma.notification.createMany).mockClear();
    vi.mocked(prisma.matchup.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.matchup.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.league.updateMany).mockResolvedValueOnce({ count: 0 } as never);

    await finalizeLeagueWeek('league1', 1, 2026);

    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('announces the champion when the season completes', async () => {
    vi.mocked(prisma.leagueEvent.create).mockClear();
    vi.mocked(prisma.matchup.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.matchup.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.matchup.findFirst).mockResolvedValueOnce({ winnerId: 'h' } as never);
    vi.mocked(prisma.team.findUnique).mockResolvedValueOnce({ name: 'Heavy Hitters' } as never);

    await finalizeLeagueWeek('league1', 12, 2026);

    expect(prisma.leagueEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leagueId: 'league1',
        type: 'season_complete',
        message: '🏆 Heavy Hitters wins the championship! The season is complete.',
      }),
    });
    // Season is over — no lineup reminder
    expect(prisma.notification.createMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ type: 'lineup_reminder' })]),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// firstScoringTuesdayPT — first Tuesday after the draft
// All draft times are noon UTC so PT date == UTC date (PDT is UTC-7 in summer).
// ---------------------------------------------------------------------------
describe('firstScoringTuesdayPT', () => {
  // Whole week of July 1–7, 2026:  Wed / Thu / Fri / Sat / Sun / Mon all land on July 7;
  // a Tuesday draft skips to the following Tuesday (July 14).
  it('Wednesday draft → next Tuesday (+6 days)', () => {
    expect(firstScoringTuesdayPT(new Date('2026-07-01T12:00:00Z'))).toBe('2026-07-07');
  });

  it('Thursday draft → next Tuesday (+5 days)', () => {
    expect(firstScoringTuesdayPT(new Date('2026-07-02T12:00:00Z'))).toBe('2026-07-07');
  });

  it('Friday draft → next Tuesday (+4 days)', () => {
    expect(firstScoringTuesdayPT(new Date('2026-07-03T12:00:00Z'))).toBe('2026-07-07');
  });

  it('Saturday draft → next Tuesday (+3 days)', () => {
    expect(firstScoringTuesdayPT(new Date('2026-07-04T12:00:00Z'))).toBe('2026-07-07');
  });

  it('Sunday draft → next Tuesday (+2 days)', () => {
    expect(firstScoringTuesdayPT(new Date('2026-07-05T12:00:00Z'))).toBe('2026-07-07');
  });

  it('Monday draft → next day (Tuesday, +1 day)', () => {
    expect(firstScoringTuesdayPT(new Date('2026-07-06T12:00:00Z'))).toBe('2026-07-07');
  });

  it('Tuesday draft → 7 days later, not the same Tuesday', () => {
    // Week-1 exception: a Tuesday draft means the first FULL scoring week starts
    // the following Tuesday, so lineups opened that Tuesday have a full week ahead.
    expect(firstScoringTuesdayPT(new Date('2026-07-07T12:00:00Z'))).toBe('2026-07-14');
  });
});

// ---------------------------------------------------------------------------
// Week 1 finalization gate
// The finalize pipeline skips a Week-1 league until the Monday after the
// first full scoring week (firstScoringTuesdayPT + 6 days).
// ---------------------------------------------------------------------------
describe('runFinalizePipeline once-per-PT-date guard', () => {
  const todayPT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const league = (id: string, lastFinalizedDatePT: string | null) => ({
    id, currentWeek: 3, seasonYear: 2026, draftTime: null, lastFinalizedDatePT,
  });

  beforeEach(() => {
    // Clear call history (keeps the factory defaults) — earlier describes
    // also exercise these mocks.
    vi.mocked(prisma.matchup.updateMany).mockClear();
    vi.mocked(prisma.league.update).mockClear();
  });

  it('skips leagues already finalized today (restart/deploy re-run)', async () => {
    vi.mocked(prisma.league.findMany).mockResolvedValueOnce([league('l-done', todayPT)] as never);
    await runFinalizePipeline();
    expect(prisma.matchup.updateMany).not.toHaveBeenCalled();
    expect(prisma.league.update).not.toHaveBeenCalled();
  });

  it('finalizes unguarded leagues and stamps today PT afterwards', async () => {
    vi.mocked(prisma.league.findMany).mockResolvedValueOnce([
      league('l-done', todayPT),
      league('l-fresh', null),
      league('l-old', '2026-07-06'),
    ] as never);
    await runFinalizePipeline();

    // Only the two unguarded leagues finalize + get stamped
    const finalized = vi.mocked(prisma.matchup.updateMany).mock.calls.map((c) => (c[0].where as { leagueId: string }).leagueId);
    expect(finalized).toEqual(['l-fresh', 'l-old']);
    const stamped = vi.mocked(prisma.league.update).mock.calls.map((c) => c[0]);
    expect(stamped).toEqual([
      { where: { id: 'l-fresh' }, data: { lastFinalizedDatePT: todayPT } },
      { where: { id: 'l-old' }, data: { lastFinalizedDatePT: todayPT } },
    ]);
  });

  it('force bypasses the guard for deliberate manual re-runs', async () => {
    vi.mocked(prisma.league.findMany).mockResolvedValueOnce([league('l-done', todayPT)] as never);
    await runFinalizePipeline({ force: true });
    expect(vi.mocked(prisma.matchup.updateMany).mock.calls[0][0].where).toMatchObject({ leagueId: 'l-done' });
  });
});

describe('Week 1 finalization gate', () => {
  // Helper mirrors the main() skip check so we can assert the exact cutoff date.
  function firstFinalizeMondayPT(draftTime: Date): string {
    const tuesdayStr = firstScoringTuesdayPT(draftTime);
    const tuesdayDate = new Date(tuesdayStr + 'T12:00:00Z');
    const monday = new Date(tuesdayDate);
    monday.setUTCDate(tuesdayDate.getUTCDate() + 6);
    return monday.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  }

  // Wednesday July 1 draft → first scoring Tuesday = July 7 → first finalize Monday = July 13
  const wednesdayDraft = new Date('2026-07-01T12:00:00Z');

  it('first finalize Monday is 13 days after a Wednesday draft', () => {
    expect(firstFinalizeMondayPT(wednesdayDraft)).toBe('2026-07-13');
  });

  it('should skip on the first scoring Tuesday (week has not ended yet)', () => {
    const firstTuesdayPT = firstScoringTuesdayPT(wednesdayDraft); // '2026-07-07'
    const firstMondayPT = firstFinalizeMondayPT(wednesdayDraft);  // '2026-07-13'
    expect(firstTuesdayPT < firstMondayPT).toBe(true);            // July 7 < July 13 → skip
  });

  it('should skip on the Sunday before the first finalize Monday', () => {
    const todayPT = '2026-07-12'; // Sunday before July 13
    const firstMondayPT = firstFinalizeMondayPT(wednesdayDraft);
    expect(todayPT < firstMondayPT).toBe(true);
  });

  it('should finalize on the first Monday after the first scoring week', () => {
    const todayPT = '2026-07-13'; // Monday — first scoring week Tue-Sun is complete
    const firstMondayPT = firstFinalizeMondayPT(wednesdayDraft);
    expect(todayPT < firstMondayPT).toBe(false);
  });

  it('Tuesday draft: first finalize Monday is 20 days later', () => {
    // Tuesday July 7 draft → first scoring Tuesday = July 14 → first finalize Monday = July 20
    const tuesdayDraft = new Date('2026-07-07T12:00:00Z');
    expect(firstFinalizeMondayPT(tuesdayDraft)).toBe('2026-07-20');
  });
});
