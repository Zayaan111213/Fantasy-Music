import { describe, it, expect, vi, beforeEach } from 'vitest';

// bracket.ts imports the prisma singleton; the pure functions under test never
// touch it. ensurePlayoffMatchups does, so the stub carries real vi.fn()s for
// its calls (harmless no-ops for the pure-function tests above, which never
// invoke them).
vi.mock('../../db/prisma', () => ({
  prisma: {
    matchup: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    team: { findMany: vi.fn().mockResolvedValue([]) },
    league: { update: vi.fn() },
    leagueEvent: { create: vi.fn() },
  },
}));

import { prisma } from '../../db/prisma';
import {
  buildWeek11Matchups,
  buildWeek12Matchups,
  ensurePlayoffMatchups,
  PLAYOFF_FINALS_WEEK,
  PLAYOFF_SEMIS_WEEK,
  REGULAR_SEASON_WEEKS,
  type FinalizedPlayoffMatchup,
  type PlayoffMatchupInput,
  type SeededTeam,
} from '../../playoffs/bracket';

const LEAGUE = 'league1';

function seeds(n: number): SeededTeam[] {
  return Array.from({ length: n }, (_, i) => ({ teamId: `t${i + 1}`, seed: i + 1 }));
}

// Compact "1v4" form for readable assertions; home listed first.
function pairs(matchups: PlayoffMatchupInput[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of matchups) {
    (out[m.matchupType] ??= []).push(`${m.homeSeed}v${m.awaySeed}`);
  }
  return out;
}

// Finalize a week-11 game with the given winning seed.
function finalized(m: PlayoffMatchupInput, winningSeed: number): FinalizedPlayoffMatchup {
  return {
    matchupType: m.matchupType,
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    homeSeed: m.homeSeed,
    awaySeed: m.awaySeed,
    winnerId: m.homeSeed === winningSeed ? m.homeTeamId : m.awayTeamId,
  };
}

describe('buildWeek11Matchups', () => {
  it('returns no matchups for fewer than 4 teams', () => {
    expect(buildWeek11Matchups(LEAGUE, seeds(2))).toEqual([]);
    expect(buildWeek11Matchups(LEAGUE, seeds(3))).toEqual([]);
  });

  it('4 teams: semifinals 1v4 and 2v3, no consolation', () => {
    expect(pairs(buildWeek11Matchups(LEAGUE, seeds(4)))).toEqual({
      semifinal: ['1v4', '2v3'],
    });
  });

  it('5 teams: seed 5 sits out', () => {
    expect(pairs(buildWeek11Matchups(LEAGUE, seeds(5)))).toEqual({
      semifinal: ['1v4', '2v3'],
    });
  });

  it('6 teams: single 5v6 game decides 5th place', () => {
    expect(pairs(buildWeek11Matchups(LEAGUE, seeds(6)))).toEqual({
      semifinal: ['1v4', '2v3'],
      fifth_place: ['5v6'],
    });
  });

  it('7 teams: consolation semifinal 6v7 with a seed-5 bye', () => {
    expect(pairs(buildWeek11Matchups(LEAGUE, seeds(7)))).toEqual({
      semifinal: ['1v4', '2v3'],
      consolation_semifinal: ['6v7'],
    });
  });

  it.each([8, 9, 10, 12])('%i teams: full consolation bracket 5v8 and 6v7', (n) => {
    expect(pairs(buildWeek11Matchups(LEAGUE, seeds(n)))).toEqual({
      semifinal: ['1v4', '2v3'],
      consolation_semifinal: ['5v8', '6v7'],
    });
  });

  it('better seed is always the home team, in week 11', () => {
    for (const m of buildWeek11Matchups(LEAGUE, seeds(8))) {
      expect(m.homeSeed).toBeLessThan(m.awaySeed);
      expect(m.week).toBe(PLAYOFF_SEMIS_WEEK);
      expect(m.leagueId).toBe(LEAGUE);
    }
  });
});

describe('buildWeek12Matchups', () => {
  it('8 teams: championship, 3rd, 5th and 7th place games from week-11 results', () => {
    const s = seeds(8);
    const week11 = buildWeek11Matchups(LEAGUE, s);
    // Winners: 4 upsets 1, 2 beats 3, 8 upsets 5, 6 beats 7
    const results = [
      finalized(week11[0], 4),
      finalized(week11[1], 2),
      finalized(week11[2], 8),
      finalized(week11[3], 6),
    ];
    expect(pairs(buildWeek12Matchups(LEAGUE, s, results))).toEqual({
      championship: ['2v4'],
      third_place: ['1v3'],
      fifth_place: ['6v8'],
      seventh_place: ['5v7'],
    });
  });

  it('4 teams: championship and 3rd place only', () => {
    const s = seeds(4);
    const week11 = buildWeek11Matchups(LEAGUE, s);
    const results = [finalized(week11[0], 1), finalized(week11[1], 3)];
    expect(pairs(buildWeek12Matchups(LEAGUE, s, results))).toEqual({
      championship: ['1v3'],
      third_place: ['2v4'],
    });
  });

  it('6 teams: no week-12 consolation game (5th place was decided in week 11)', () => {
    const s = seeds(6);
    const week11 = buildWeek11Matchups(LEAGUE, s);
    const results = week11.map((m) => finalized(m, m.homeSeed));
    expect(pairs(buildWeek12Matchups(LEAGUE, s, results))).toEqual({
      championship: ['1v2'],
      third_place: ['3v4'],
    });
  });

  it('7 teams: seed 5 comes off the bye into the 5th place game; loser of 6v7 has no game', () => {
    const s = seeds(7);
    const week11 = buildWeek11Matchups(LEAGUE, s);
    const results = [finalized(week11[0], 1), finalized(week11[1], 2), finalized(week11[2], 7)];
    expect(pairs(buildWeek12Matchups(LEAGUE, s, results))).toEqual({
      championship: ['1v2'],
      third_place: ['3v4'],
      fifth_place: ['5v7'],
    });
  });

  it('all week-12 games are in the finals week with the better seed at home', () => {
    const s = seeds(8);
    const week11 = buildWeek11Matchups(LEAGUE, s);
    const results = week11.map((m) => finalized(m, m.awaySeed));
    for (const m of buildWeek12Matchups(LEAGUE, s, results)) {
      expect(m.week).toBe(PLAYOFF_FINALS_WEEK);
      expect(m.homeSeed).toBeLessThan(m.awaySeed);
    }
  });

  it('throws when a week-11 playoff game has no winner', () => {
    const s = seeds(4);
    const week11 = buildWeek11Matchups(LEAGUE, s);
    const results = [{ ...finalized(week11[0], 1), winnerId: null }, finalized(week11[1], 2)];
    expect(() => buildWeek12Matchups(LEAGUE, s, results)).toThrow(/missing winner/);
  });

  it('throws when semifinals are missing', () => {
    expect(() => buildWeek12Matchups(LEAGUE, seeds(8), [])).toThrow(/expected 2 finalized semifinals/);
  });
});

describe('ensurePlayoffMatchups', () => {
  beforeEach(() => {
    vi.mocked(prisma.matchup.findFirst).mockReset().mockResolvedValue(null);
    vi.mocked(prisma.matchup.createMany).mockReset().mockResolvedValue({ count: 4 });
    vi.mocked(prisma.team.findMany).mockReset().mockResolvedValue(
      seeds(4).map((s) => ({ id: s.teamId, name: s.teamId, wins: 0, pointsFor: 0, createdAt: new Date() })) as never,
    );
    vi.mocked(prisma.leagueEvent.create).mockReset();
  });

  it('logs playoffs_set once when this call actually inserts the matchups', async () => {
    await ensurePlayoffMatchups(LEAGUE, REGULAR_SEASON_WEEKS);
    expect(prisma.leagueEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.leagueEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'playoffs_set' }) }),
    );
  });

  it('does not log a duplicate playoffs_set when a concurrent caller already inserted the matchups', async () => {
    // Both callers pass the `existing` pre-check (still null) before either commits;
    // this caller's createMany then hits skipDuplicates and inserts nothing.
    vi.mocked(prisma.matchup.createMany).mockResolvedValue({ count: 0 });
    await ensurePlayoffMatchups(LEAGUE, REGULAR_SEASON_WEEKS);
    expect(prisma.leagueEvent.create).not.toHaveBeenCalled();
  });

  it('no-ops entirely when the target week already has matchups', async () => {
    vi.mocked(prisma.matchup.findFirst).mockResolvedValue({ id: 'existing' } as never);
    await ensurePlayoffMatchups(LEAGUE, REGULAR_SEASON_WEEKS);
    expect(prisma.matchup.createMany).not.toHaveBeenCalled();
    expect(prisma.leagueEvent.create).not.toHaveBeenCalled();
  });
});
