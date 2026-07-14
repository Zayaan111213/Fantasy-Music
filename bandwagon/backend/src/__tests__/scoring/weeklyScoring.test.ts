import { describe, it, expect, vi, beforeAll } from 'vitest';

// vi.mock is hoisted — factory runs before imports, providing defaults so that
// main() in finalizePipeline (called at module load) finds an empty league list
// and exits cleanly instead of throwing.
vi.mock('../../db/prisma', () => ({
  prisma: {
    chartEntry:      { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    albumChartEntry: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
    weeklyScore:     { upsert: vi.fn(), findUnique: vi.fn() },
    matchup: {
      findMany:   vi.fn(),
      findFirst:  vi.fn().mockResolvedValue({ id: 'nextWeekMatchup' }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update:     vi.fn(),
    },
    league: {
      findMany:   vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ scoringConfig: null }),
      update:     vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    team:        { update: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    notification: { createMany: vi.fn() },
    leagueEvent:  { create: vi.fn() },
    rosterSpot:  { findMany: vi.fn().mockResolvedValue([]) },
    trade:       { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    waiverClaim: { findMany: vi.fn().mockResolvedValue([]) },
    tradeItem:   { findMany: vi.fn().mockResolvedValue([]) },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../jobs/ingestCharts', () => ({
  getCurrentWeekDate: vi.fn().mockReturnValue(new Date('2026-06-17T07:00:00Z')),
}));

import { prisma } from '../../db/prisma';
import { scoreArtistWeekFromCharts, updateMatchupScores } from '../../scoring/engine';
import { finalizeLeagueWeek } from '../../jobs/finalizePipeline';

// ── Scenario ─────────────────────────────────────────────────────────────────
//
// Week 2, 2026. Two teams (Home = Alpha, Away = Beta) face off.
// Both artists were on the chart in Week 1 (2026-06-10) → 2 consecutive weeks
// → longevityPoints = 2 for both, all phases.
//
// Day 1:  Alpha rank 5 (was 10), Beta rank 20 (was 25)
//   Alpha: pos 18 + mov +5 + lon 2 = 25 pts   Home matchup score: 25
//   Beta:  pos 12 + mov +5 + lon 2 = 19 pts   Away matchup score: 19
//
// Day 4:  Alpha climbs to rank 1, Beta to rank 8
//   Alpha: pos 25 + mov +9 + lon 2 = 36 pts   Home matchup score: 36
//   Beta:  pos 18 + mov +17→cap 15 + lon 2 = 35 pts  Away matchup score: 35
//
// Finalization: Home wins 36–35; wins++, Away losses++, both teams get pointsFor.

const LEAGUE_ID = 'league1';
const WEEK      = 2;
const YEAR      = 2026;
const WEEK_DATE = new Date('2026-06-17T07:00:00Z'); // Tuesday midnight PT

let phase: 'day1' | 'day4' = 'day1';

// In-memory store bridges scoreArtistWeekFromCharts (upsert) → updateMatchupScores (findUnique).
const weeklyScoreStore = new Map<string, Record<string, unknown>>();

// Tracks matchup state as the pipeline writes homeScore/awayScore/winnerId.
const matchupState = { homeScore: 0, awayScore: 0, winnerId: null as string | null };

const ALPHA_BASE = { chart: 'US', songTitle: 'Alpha Song', appleSongId: BigInt(111), weekDate: WEEK_DATE, artistId: 'alpha' };
const BETA_BASE  = { chart: 'US', songTitle: 'Beta Song',  appleSongId: BigInt(222), weekDate: WEEK_DATE, artistId: 'beta'  };

function chartSongs(artistId: string): unknown[] {
  if (artistId === 'alpha')
    return phase === 'day1'
      ? [{ ...ALPHA_BASE, rank: 5 }]
      : [{ ...ALPHA_BASE, rank: 1 }, { ...ALPHA_BASE, rank: 5 }];
  if (artistId === 'beta')
    return phase === 'day1'
      ? [{ ...BETA_BASE, rank: 20 }]
      : [{ ...BETA_BASE, rank: 8 }, { ...BETA_BASE, rank: 20 }];
  return [];
}

const MATCHUP_WITH_TEAMS = {
  id: 'matchup1', leagueId: LEAGUE_ID, week: WEEK,
  homeTeamId: 'teamHome', awayTeamId: 'teamAway', homeScore: 0, awayScore: 0,
  homeTeam: { id: 'teamHome', rosterSpots: [{ artistId: 'alpha', slot: 'Pop', artist: { primaryGenre: 'Pop' } }] },
  awayTeam: { id: 'teamAway', rosterSpots: [{ artistId: 'beta',  slot: 'Pop', artist: { primaryGenre: 'Pop' } }] },
};

// ── Wire all mocks once before any test runs ─────────────────────────────────

beforeAll(() => {
  vi.mocked(prisma.chartEntry.findMany).mockImplementation(async (args: any) =>
    chartSongs(args.where.artistId) as never
  );

  // Prior-week song lookup: Alpha was at 10, Beta was at 25
  vi.mocked(prisma.chartEntry.findFirst).mockImplementation(async (args: any) => {
    if (args.where.appleSongId === BigInt(111)) return { rank: 10, ...ALPHA_BASE } as never;
    if (args.where.appleSongId === BigInt(222)) return { rank: 25, ...BETA_BASE  } as never;
    return null as never;
  });

  // Longevity count: 1 for the week immediately prior to WEEK_DATE, 0 for any earlier week
  vi.mocked(prisma.chartEntry.count).mockImplementation(async (args: any) => {
    const d = (args.where.weekDate as Date).toISOString().slice(0, 10);
    return (d === '2026-06-10' ? 1 : 0) as never;
  });

  // weeklyScore.upsert writes to store; findUnique reads it back
  vi.mocked(prisma.weeklyScore.upsert).mockImplementation(async (args: any) => {
    const key = `${args.create.artistId}_${args.create.weekDate.toISOString()}`;
    weeklyScoreStore.set(key, { ...args.create });
    return args.create as never;
  });
  vi.mocked(prisma.weeklyScore.findUnique).mockImplementation(async (args: any) => {
    const { artistId, weekDate } = args.where.artistId_weekDate;
    return (weeklyScoreStore.get(`${artistId}_${weekDate.toISOString()}`) ?? null) as never;
  });

  // matchup.findMany: with include = updateMatchupScores path; without = finalizeLeagueWeek path
  vi.mocked(prisma.matchup.findMany).mockImplementation(async (args: any) => {
    if (args.include) return [MATCHUP_WITH_TEAMS] as never;
    return [{
      id: 'matchup1', leagueId: LEAGUE_ID, week: WEEK, isFinalized: false, winnerId: null,
      matchupType: 'regular', homeSeed: null, awaySeed: null,
      homeTeamId: 'teamHome', awayTeamId: 'teamAway',
      homeScore: matchupState.homeScore, awayScore: matchupState.awayScore,
    }] as never;
  });

  // matchup.update: capture scores (from updateMatchupScores) and winnerId (from finalizeLeagueWeek)
  vi.mocked(prisma.matchup.update).mockImplementation(async (args: any) => {
    if (args.data.homeScore !== undefined) {
      matchupState.homeScore = args.data.homeScore;
      matchupState.awayScore = args.data.awayScore;
    }
    if ('winnerId' in args.data) matchupState.winnerId = args.data.winnerId;
    return {} as never;
  });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('weekly scoring pipeline — mid-week chart update', () => {
  describe('Phase 1 — Day 1 (Alpha rank 5, Beta rank 20)', () => {
    beforeAll(async () => {
      phase = 'day1';
      await scoreArtistWeekFromCharts('alpha', WEEK_DATE);
      await scoreArtistWeekFromCharts('beta',  WEEK_DATE);
      await updateMatchupScores(LEAGUE_ID, WEEK, WEEK_DATE);
    });

    it('Alpha earns 25pts: rank-5 pos (18) + movement +5 + longevity 2wk (2)', () => {
      const s = weeklyScoreStore.get(`alpha_${WEEK_DATE.toISOString()}`);
      expect(s?.chartPositionPoints).toBe(18);
      expect(s?.chartMovementPoints).toBe(5);
      expect(s?.longevityPoints).toBe(2);
      expect(s?.totalPoints).toBe(25);
    });

    it('Beta earns 19pts: rank-20 pos (12) + movement +5 + longevity 2wk (2)', () => {
      const s = weeklyScoreStore.get(`beta_${WEEK_DATE.toISOString()}`);
      expect(s?.chartPositionPoints).toBe(12);
      expect(s?.chartMovementPoints).toBe(5);
      expect(s?.longevityPoints).toBe(2);
      expect(s?.totalPoints).toBe(19);
    });

    it('matchup score is 25–19 after Day 1', () => {
      expect(matchupState.homeScore).toBe(25);
      expect(matchupState.awayScore).toBe(19);
    });
  });

  describe('Phase 2 — Day 4 (Alpha climbs to rank 1, Beta to rank 8)', () => {
    beforeAll(async () => {
      phase = 'day4';
      await scoreArtistWeekFromCharts('alpha', WEEK_DATE);
      await scoreArtistWeekFromCharts('beta',  WEEK_DATE);
      await updateMatchupScores(LEAGUE_ID, WEEK, WEEK_DATE);
    });

    it('Alpha improves to 36pts: rank-1 pos (25) + movement +9 + longevity 2wk (2)', () => {
      const s = weeklyScoreStore.get(`alpha_${WEEK_DATE.toISOString()}`);
      expect(s?.chartPositionPoints).toBe(25);
      expect(s?.chartMovementPoints).toBe(9);
      expect(s?.longevityPoints).toBe(2);
      expect(s?.totalPoints).toBe(36);
    });

    it('Beta improves to 35pts: rank-8 pos (18) + movement +17 capped to 15 + longevity 2wk (2)', () => {
      const s = weeklyScoreStore.get(`beta_${WEEK_DATE.toISOString()}`);
      expect(s?.chartPositionPoints).toBe(18);
      expect(s?.chartMovementPoints).toBe(15);
      expect(s?.longevityPoints).toBe(2);
      expect(s?.totalPoints).toBe(35);
    });

    it('matchup score is 36–35 after Day 4', () => {
      expect(matchupState.homeScore).toBe(36);
      expect(matchupState.awayScore).toBe(35);
    });
  });

  describe('Phase 3 — finalization (Home wins 36–35)', () => {
    beforeAll(async () => {
      vi.mocked(prisma.matchup.updateMany).mockResolvedValueOnce({ count: 1 } as never);
      await finalizeLeagueWeek(LEAGUE_ID, WEEK, WEEK_DATE);
    });

    it('home team is recorded as the winner', () => {
      expect(matchupState.winnerId).toBe('teamHome');
    });

    it('home team wins record incremented by 1', () => {
      expect(prisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'teamHome' }, data: { wins: { increment: 1 } } })
      );
    });

    it('away team losses record incremented by 1', () => {
      expect(prisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'teamAway' }, data: { losses: { increment: 1 } } })
      );
    });

    it('home team pointsFor accumulates 36 pts', () => {
      expect(prisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'teamHome' }, data: { pointsFor: { increment: 36 } } })
      );
    });

    it('away team pointsFor accumulates 35 pts', () => {
      expect(prisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'teamAway' }, data: { pointsFor: { increment: 35 } } })
      );
    });

    it('league advances from week 2 to week 3', () => {
      expect(prisma.league.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: LEAGUE_ID, currentWeek: { lt: 3 } },
          data: { currentWeek: 3 },
        })
      );
    });
  });
});
