import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma', () => ({
  prisma: {
    matchup: { findMany: vi.fn(), update: vi.fn() },
    league: { findUnique: vi.fn() },
    weeklyScore: { findUnique: vi.fn() },
    genreStreamingTier: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../db/prisma';
import { updateMatchupScores } from '../../scoring/engine';

const pm = prisma as unknown as {
  matchup: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  league: { findUnique: ReturnType<typeof vi.fn> };
  weeklyScore: { findUnique: ReturnType<typeof vi.fn> };
  genreStreamingTier: { findMany: ReturnType<typeof vi.fn> };
};

// ScoringConfig with custom chart position: rank 1 = 100 pts (default is 25)
const CUSTOM_CONFIG = {
  chartPosition: [100, 18, 12, 8, 4],
  chartMovement: { newEntryBonus: 10, maxGain: 15, maxDrop: 10 },
  streaming: {},
};

// Weekly score: rank 1, moved up 5, 2 longevity pts, default totalPoints=32 (ignored when custom)
const WS_RANK1 = {
  weeklyStreams: null,
  bestChartPosition: 1,
  chartMovement: 5,
  longevityPoints: 2,
  totalPoints: 32,
};

// Roster spot helpers
function rosterSpot(artistId: string, genre: string) {
  return { artistId, artist: { primaryGenre: genre } };
}

function matchupFixture(homeSpots: ReturnType<typeof rosterSpot>[], awaySpots: ReturnType<typeof rosterSpot>[]) {
  return {
    id: 'matchup-1',
    homeTeam: { rosterSpots: homeSpots },
    awayTeam: { rosterSpots: awaySpots },
  };
}

// Genre tier row (points don't matter since weeklyStreams is null throughout)
const GENRE_TIER = {
  minStreams: BigInt(0),
  maxStreams: BigInt(999_999_999),
  points: 10,
  genre: 'Pop',
  sortOrder: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  pm.matchup.update.mockResolvedValue({});
  pm.genreStreamingTier.findMany.mockResolvedValue([GENRE_TIER]);
});

describe('updateMatchupScores — custom scoring', () => {
  it('applies custom chartPosition tiers: rank 1 scores 100 instead of 25', async () => {
    pm.matchup.findMany.mockResolvedValue([
      matchupFixture([rosterSpot('artist-a', 'Pop')], []),
    ]);
    pm.league.findUnique.mockResolvedValue({ scoringConfig: CUSTOM_CONFIG });
    pm.weeklyScore.findUnique.mockResolvedValue(WS_RANK1);

    await updateMatchupScores('league-1', 2, 2026);

    // Custom: 0 (no streams) + 100 (rank 1, custom) + 5 (movement) + 2 (longevity) = 107
    expect(pm.matchup.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ homeScore: 107, awayScore: 0 }) })
    );
  });

  it('falls back to totalPoints from WeeklyScore when scoringConfig is null', async () => {
    pm.matchup.findMany.mockResolvedValue([
      matchupFixture([rosterSpot('artist-a', 'Pop')], []),
    ]);
    pm.league.findUnique.mockResolvedValue({ scoringConfig: null });
    pm.weeklyScore.findUnique.mockResolvedValue(WS_RANK1);

    await updateMatchupScores('league-1', 2, 2026);

    // No custom config → use ws.totalPoints = 32
    expect(pm.matchup.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ homeScore: 32, awayScore: 0 }) })
    );
  });

  it('scores 0 for an empty slot (null artistId)', async () => {
    pm.matchup.findMany.mockResolvedValue([
      matchupFixture([{ artistId: null, artist: null }], []),
    ]);
    pm.league.findUnique.mockResolvedValue({ scoringConfig: CUSTOM_CONFIG });

    await updateMatchupScores('league-1', 2, 2026);

    expect(pm.matchup.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ homeScore: 0 }) })
    );
    expect(pm.weeklyScore.findUnique).not.toHaveBeenCalled();
  });

  it('scores 0 when artist has no WeeklyScore record yet', async () => {
    pm.matchup.findMany.mockResolvedValue([
      matchupFixture([rosterSpot('artist-new', 'Pop')], []),
    ]);
    pm.league.findUnique.mockResolvedValue({ scoringConfig: CUSTOM_CONFIG });
    pm.weeklyScore.findUnique.mockResolvedValue(null);

    await updateMatchupScores('league-1', 2, 2026);

    expect(pm.matchup.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ homeScore: 0 }) })
    );
  });

  it('caches genre tiers: two spots with the same genre trigger only one DB lookup', async () => {
    pm.matchup.findMany.mockResolvedValue([
      matchupFixture(
        [rosterSpot('artist-a', 'Pop'), rosterSpot('artist-b', 'Pop')],
        [],
      ),
    ]);
    pm.league.findUnique.mockResolvedValue({ scoringConfig: CUSTOM_CONFIG });
    pm.weeklyScore.findUnique.mockResolvedValue(WS_RANK1);

    await updateMatchupScores('league-1', 2, 2026);

    // Both spots are 'Pop' — cache prevents a second DB hit
    const popCalls = pm.genreStreamingTier.findMany.mock.calls.filter(
      (c: any[]) => c[0]?.where?.genre === 'Pop'
    );
    expect(popCalls).toHaveLength(1);
  });

  it('makes separate tier lookups for two different genres', async () => {
    pm.matchup.findMany.mockResolvedValue([
      matchupFixture(
        [rosterSpot('artist-a', 'Pop'), rosterSpot('artist-b', 'Country')],
        [],
      ),
    ]);
    pm.league.findUnique.mockResolvedValue({ scoringConfig: CUSTOM_CONFIG });
    pm.weeklyScore.findUnique.mockResolvedValue(WS_RANK1);
    pm.genreStreamingTier.findMany.mockImplementation(async (args: any) => {
      return [{ ...GENRE_TIER, genre: args.where.genre }];
    });

    await updateMatchupScores('league-1', 2, 2026);

    const genres = pm.genreStreamingTier.findMany.mock.calls.map((c: any[]) => c[0]?.where?.genre);
    expect(genres).toContain('Pop');
    expect(genres).toContain('Country');
    expect(pm.genreStreamingTier.findMany).toHaveBeenCalledTimes(2);
  });

  it('sums scores across all starter slots for both teams', async () => {
    pm.matchup.findMany.mockResolvedValue([
      matchupFixture(
        [rosterSpot('a1', 'Pop'), rosterSpot('a2', 'Pop')],
        [rosterSpot('b1', 'Pop')],
      ),
    ]);
    pm.league.findUnique.mockResolvedValue({ scoringConfig: CUSTOM_CONFIG });
    // All artists score 107 (rank 1 custom)
    pm.weeklyScore.findUnique.mockResolvedValue(WS_RANK1);

    await updateMatchupScores('league-1', 2, 2026);

    // homeScore = 107 × 2 = 214; awayScore = 107 × 1 = 107
    expect(pm.matchup.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ homeScore: 214, awayScore: 107 }) })
    );
  });
});
