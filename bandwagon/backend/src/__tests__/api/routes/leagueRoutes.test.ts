import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// All mocks hoisted before any import that might trigger module execution

vi.mock('../../../db/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn() },
    team: { findMany: vi.fn(), findFirst: vi.fn() },
    matchup: { findFirst: vi.fn(), findUnique: vi.fn() },
    artist: { findUnique: vi.fn(), findMany: vi.fn() },
    genreStreamingTier: { findMany: vi.fn() },
    rosterSpot: { findUnique: vi.fn(), update: vi.fn() },
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
import { weekDateForLeagueWeek } from '../../../scoring/engine';

const pm = prisma as unknown as {
  league: { findUnique: ReturnType<typeof vi.fn> };
  team: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  matchup: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  artist: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  genreStreamingTier: { findMany: ReturnType<typeof vi.fn> };
  rosterSpot: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const app = express();
app.use(express.json());
app.use('/leagues', leagueRouter);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /leagues/:id/standings
// ---------------------------------------------------------------------------

describe('GET /leagues/:id/standings', () => {
  it('returns 404 when league not found', async () => {
    pm.league.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/leagues/bad-id/standings');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('League not found');
  });

  it('returns teams with sequential rank numbers', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1' });
    pm.team.findMany.mockResolvedValue([
      { id: 't1', name: 'Top Dogs', logoUrl: null, userId: 'u1', wins: 7, losses: 2, pointsFor: 500,
        user: { username: 'alice', avatarUrl: null } },
      { id: 't2', name: 'Underdogs', logoUrl: null, userId: 'u2', wins: 3, losses: 6, pointsFor: 300,
        user: { username: 'bob', avatarUrl: null } },
    ]);

    const res = await request(app).get('/leagues/l1/standings');
    expect(res.status).toBe(200);
    expect(res.body[0].rank).toBe(1);
    expect(res.body[0].teamId).toBe('t1');
    expect(res.body[0].wins).toBe(7);
    expect(res.body[1].rank).toBe(2);
    expect(res.body[1].teamId).toBe('t2');
  });

  it('returns all required fields for each standing entry', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1' });
    pm.team.findMany.mockResolvedValue([
      { id: 't1', name: 'The Squad', logoUrl: 'logo.png', userId: 'u1', wins: 5, losses: 3, pointsFor: 400,
        waiverPriority: 2, user: { username: 'alice', avatarUrl: 'av.png' } },
    ]);

    const res = await request(app).get('/leagues/l1/standings');
    expect(res.status).toBe(200);
    const entry = res.body[0];
    expect(entry).toMatchObject({
      rank: 1, teamId: 't1', teamName: 'The Squad', teamLogoUrl: 'logo.png',
      userId: 'u1', username: 'alice', avatarUrl: 'av.png',
      wins: 5, losses: 3, pointsFor: 400, waiverPriority: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /leagues/:id/matchups/current
// ---------------------------------------------------------------------------

describe('GET /leagues/:id/matchups/current', () => {
  it('returns 404 when league not found', async () => {
    pm.league.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/leagues/bad/matchups/current');
    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not a member', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1', currentWeek: 2, seasonYear: 2026 });
    pm.team.findFirst.mockResolvedValue(null); // user-1 has no team

    const res = await request(app).get('/leagues/l1/matchups/current');
    expect(res.status).toBe(403);
  });

  it('returns null when no matchup exists yet (pre-season)', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1', currentWeek: 1, seasonYear: 2026 });
    pm.team.findFirst.mockResolvedValue({ id: 'my-team' });
    pm.matchup.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/leagues/l1/matchups/current');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('returns matchup with correct week (currentWeek from league)', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1', currentWeek: 3, seasonYear: 2026 });
    pm.team.findFirst.mockResolvedValue({ id: 'my-team' });
    pm.matchup.findFirst.mockResolvedValue({
      id: 'm1', week: 3, homeScore: 85, awayScore: 72,
      homeTeam: { id: 'my-team', user: { username: 'alice', avatarUrl: null }, rosterSpots: [] },
      awayTeam: { id: 'opp-team', user: { username: 'bob', avatarUrl: null }, rosterSpots: [] },
    });

    const res = await request(app).get('/leagues/l1/matchups/current');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('m1');
    expect(res.body.week).toBe(3);
    expect(res.body.homeScore).toBe(85);

    // Verify the query used the correct week
    const query = pm.matchup.findFirst.mock.calls[0][0];
    expect(query.where.week).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// GET /leagues/:id/matchups/previous
// ---------------------------------------------------------------------------

describe('GET /leagues/:id/matchups/previous', () => {
  it('returns null immediately when currentWeek <= 1 (no previous week)', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1', currentWeek: 1, seasonYear: 2026 });

    const res = await request(app).get('/leagues/l1/matchups/previous');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    // Should not query matchup table at all
    expect(pm.matchup.findFirst).not.toHaveBeenCalled();
  });

  it('returns 403 when not a member (currentWeek > 1)', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1', currentWeek: 3, seasonYear: 2026 });
    pm.team.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/leagues/l1/matchups/previous');
    expect(res.status).toBe(403);
  });

  it('queries week currentWeek-1 for the previous matchup', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1', currentWeek: 4, seasonYear: 2026 });
    pm.team.findFirst.mockResolvedValue({ id: 'my-team' });
    pm.matchup.findFirst.mockResolvedValue({
      id: 'm-prev', week: 3, homeScore: 100, awayScore: 90, winnerId: 'my-team',
      homeTeam: { id: 'my-team', user: { username: 'alice', avatarUrl: null }, rosterSpots: [] },
      awayTeam: { id: 'opp', user: { username: 'bob', avatarUrl: null }, rosterSpots: [] },
    });

    const res = await request(app).get('/leagues/l1/matchups/previous');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('m-prev');
    expect(res.body.week).toBe(3);

    const query = pm.matchup.findFirst.mock.calls[0][0];
    expect(query.where.week).toBe(3); // currentWeek - 1
  });
});

// ---------------------------------------------------------------------------
// GET /leagues/:id/matchups/:matchupId — around-the-league detail
// ---------------------------------------------------------------------------

describe('GET /leagues/:id/matchups/:matchupId', () => {
  it('returns 404 when league not found', async () => {
    pm.league.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/leagues/bad/matchups/m9');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('League not found');
  });

  it('returns 403 when user is not a member', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1', seasonYear: 2026 });
    pm.team.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/leagues/l1/matchups/m9');
    expect(res.status).toBe(403);
  });

  it('returns 404 when the matchup is not in this league', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1', seasonYear: 2026 });
    pm.team.findFirst.mockResolvedValue({ id: 'my-team' });
    pm.matchup.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/leagues/l1/matchups/other-league-matchup');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Matchup not found');
    // Scoped lookup: id AND leagueId
    expect(pm.matchup.findFirst.mock.calls[0][0].where).toEqual({
      id: 'other-league-matchup',
      leagueId: 'l1',
    });
  });

  it('returns both rosters with scores filtered to the matchup week', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1', seasonYear: 2026, currentWeek: 6 });
    pm.team.findFirst.mockResolvedValue({ id: 'my-team' });
    pm.matchup.findFirst.mockResolvedValue({ id: 'm9', week: 4, leagueId: 'l1' });
    pm.matchup.findUnique.mockResolvedValue({
      id: 'm9', week: 4, homeScore: 91.5, awayScore: 84,
      homeTeam: { id: 'tA', name: 'Alpha', user: { username: 'alice', avatarUrl: null }, rosterSpots: [] },
      awayTeam: { id: 'tB', name: 'Beta', user: { username: 'bob', avatarUrl: null }, rosterSpots: [] },
    });

    const res = await request(app).get('/leagues/l1/matchups/m9');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('m9');
    expect(res.body.homeTeam.name).toBe('Alpha');
    expect(res.body.awayTeam.name).toBe('Beta');

    // weeklyScores must resolve the matchup's own week to its calendar chart
    // week (2 weeks before the league's current one here)
    const include = pm.matchup.findUnique.mock.calls[0][0].include;
    const wsWhere = include.homeTeam.include.rosterSpots.include.artist.include.weeklyScores.where;
    expect(wsWhere).toEqual({ weekDate: weekDateForLeagueWeek(6, 4) });
  });

  it('does not swallow the literal /matchups/current route (registration order)', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1', currentWeek: 3, seasonYear: 2026 });
    pm.team.findFirst.mockResolvedValue({ id: 'my-team' });
    pm.matchup.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/leagues/l1/matchups/current');
    // The current-matchup handler returns 200 null when nothing exists; the
    // detail handler would return 404 'Matchup not found' instead.
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /leagues/:id/players — default scoring and custom scoring
// ---------------------------------------------------------------------------

const CUSTOM_CONFIG = {
  chartPosition: [100, 18, 12, 8, 4],
  chartMovement: { newEntryBonus: 10, maxGain: 15, maxDrop: 10 },
  streaming: {},
};

// Rank 1, moved +5, longevity 2 pts — default totalPoints: 32
const WS_RANK1 = {
  weeklyStreams: null, bestChartPosition: 1, chartMovement: 5, longevityPoints: 2, totalPoints: 32,
};

function artistFixture(overrides: Record<string, any> = {}) {
  return {
    id: 'artist-1', name: 'Pop Star', primaryGenre: 'Pop', imageUrl: null,
    rosterSpots: [], weeklyScores: [WS_RANK1],
    ...overrides,
  };
}

describe('GET /leagues/:id/players', () => {
  it('uses ws.totalPoints directly when scoringConfig is null (default scoring)', async () => {
    pm.league.findUnique.mockResolvedValue({ scoringConfig: null, currentWeek: 2, seasonYear: 2026 });
    pm.artist.findMany.mockResolvedValue([artistFixture()]);

    const res = await request(app).get('/leagues/l1/players');
    expect(res.status).toBe(200);
    expect(res.body[0].lastWeekPoints).toBe(32); // raw totalPoints
    expect(res.body[0].avgLast5Points).toBe(32);
  });

  it('applies custom chartPosition tiers when scoringConfig is set', async () => {
    pm.league.findUnique.mockResolvedValue({ scoringConfig: CUSTOM_CONFIG, currentWeek: 2, seasonYear: 2026 });
    pm.artist.findMany.mockResolvedValue([artistFixture()]);
    // Empty genre tiers → streaming = 0 regardless
    pm.genreStreamingTier.findMany.mockResolvedValue([]);

    const res = await request(app).get('/leagues/l1/players');
    expect(res.status).toBe(200);
    // Custom: 0 (no streams) + 100 (rank 1, custom) + 5 (movement) + 2 (longevity) = 107
    expect(res.body[0].lastWeekPoints).toBe(107);
  });

  it('avgLast5Points reflects custom scoring across multiple weeks', async () => {
    pm.league.findUnique.mockResolvedValue({ scoringConfig: CUSTOM_CONFIG, currentWeek: 3, seasonYear: 2026 });
    // Two weeks of scores: both WS_RANK1 → both score 107 with custom config
    pm.artist.findMany.mockResolvedValue([artistFixture({ weeklyScores: [WS_RANK1, WS_RANK1] })]);
    pm.genreStreamingTier.findMany.mockResolvedValue([]);

    const res = await request(app).get('/leagues/l1/players');
    expect(res.status).toBe(200);
    expect(res.body[0].avgLast5Points).toBe(107); // avg of [107, 107]
  });

  it('includes rosteredBy team when artist is on a roster in this league', async () => {
    pm.league.findUnique.mockResolvedValue({ scoringConfig: null, currentWeek: 2, seasonYear: 2026 });
    pm.artist.findMany.mockResolvedValue([
      artistFixture({
        rosterSpots: [{ team: { id: 'team-1', name: 'Top Squad' } }],
      }),
    ]);

    const res = await request(app).get('/leagues/l1/players');
    expect(res.status).toBe(200);
    expect(res.body[0].rosteredBy).toEqual({ id: 'team-1', name: 'Top Squad' });
  });

  it('returns 0 for lastWeekPoints when artist has no weekly scores', async () => {
    pm.league.findUnique.mockResolvedValue({ scoringConfig: null, currentWeek: 2, seasonYear: 2026 });
    pm.artist.findMany.mockResolvedValue([artistFixture({ weeklyScores: [] })]);

    const res = await request(app).get('/leagues/l1/players');
    expect(res.status).toBe(200);
    expect(res.body[0].lastWeekPoints).toBe(0);
    expect(res.body[0].avgLast5Points).toBe(0);
  });

  it('genre=Other matches every non-main genre (Other-slot eligibility), not the literal tag', async () => {
    pm.league.findUnique.mockResolvedValue({ scoringConfig: null, currentWeek: 2, seasonYear: 2026 });
    pm.artist.findMany.mockResolvedValue([]);

    await request(app).get('/leagues/l1/players?genre=Other');
    expect(pm.artist.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        primaryGenre: { notIn: ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country'] },
      }),
    }));

    await request(app).get('/leagues/l1/players?genre=Pop');
    expect(pm.artist.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ primaryGenre: 'Pop' }),
    }));
  });
});

// ---------------------------------------------------------------------------
// PUT /leagues/:id/roster/lineup — lineup swap
// ---------------------------------------------------------------------------

describe('PUT /leagues/:id/roster/lineup', () => {
  afterEach(() => {
    delete process.env.TEST_OVERRIDE_DAY;
  });

  it('returns 404 when league not found', async () => {
    pm.league.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/leagues/bad/roster/lineup')
      .send({ slotA: 'Flex', slotB: 'Bench-1' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('League not found');
  });

  it('returns 403 when lineup is locked on Tuesday (active league)', async () => {
    process.env.TEST_OVERRIDE_DAY = 'Tuesday';
    pm.league.findUnique.mockResolvedValue({
      id: 'l1', status: 'active', currentWeek: 2, draftTime: null,
    });

    const res = await request(app)
      .put('/leagues/l1/roster/lineup')
      .send({ slotA: 'Flex', slotB: 'Bench-1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/locked/i);
  });

  it('returns 403 when user is not a member', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1', status: 'pending', currentWeek: 1, draftTime: null });
    pm.team.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/leagues/l1/roster/lineup')
      .send({ slotA: 'Flex', slotB: 'Bench-1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/member/i);
  });

  it('returns 400 when a slot does not exist on the team', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1', status: 'pending', currentWeek: 1, draftTime: null });
    pm.team.findFirst.mockResolvedValue({ id: 'my-team' });
    pm.rosterSpot.findUnique
      .mockResolvedValueOnce({ id: 'spot-a', artistId: 'a1', slot: 'Flex' })
      .mockResolvedValueOnce(null); // spotB not found

    const res = await request(app)
      .put('/leagues/l1/roster/lineup')
      .send({ slotA: 'Flex', slotB: 'Bench-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid slots/i);
  });

  it('returns 400 when the swapped artist does not fit the destination slot', async () => {
    // Country artist in Bench-1 trying to move to Pop slot — ineligible
    pm.league.findUnique.mockResolvedValue({ id: 'l1', status: 'pending', currentWeek: 1, draftTime: null });
    pm.team.findFirst.mockResolvedValue({ id: 'my-team' });
    pm.rosterSpot.findUnique
      .mockResolvedValueOnce({ id: 'spot-bench', artistId: 'artist-country', slot: 'Bench-1' }) // slotA
      .mockResolvedValueOnce({ id: 'spot-pop', artistId: 'artist-pop', slot: 'Pop' });          // slotB
    pm.artist.findUnique
      .mockResolvedValueOnce({ id: 'artist-country', name: 'Country Star', primaryGenre: 'Country' }) // artistA
      .mockResolvedValueOnce({ id: 'artist-pop',     name: 'Pop Star',     primaryGenre: 'Pop' });    // artistB

    // artistA (Country) → slotB (Pop): ineligible
    const res = await request(app)
      .put('/leagues/l1/roster/lineup')
      .send({ slotA: 'Bench-1', slotB: 'Pop' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Country Star/);
  });

  it('returns 200 and performs the swap for a valid eligible exchange', async () => {
    pm.league.findUnique.mockResolvedValue({ id: 'l1', status: 'pending', currentWeek: 1, draftTime: null });
    pm.team.findFirst.mockResolvedValue({ id: 'my-team' });
    pm.rosterSpot.findUnique
      .mockResolvedValueOnce({ id: 'spot-flex',  artistId: 'artist-a', slot: 'Flex' })    // slotA
      .mockResolvedValueOnce({ id: 'spot-bench', artistId: 'artist-b', slot: 'Bench-1' }); // slotB
    pm.artist.findUnique
      .mockResolvedValueOnce({ id: 'artist-a', name: 'Pop Star A', primaryGenre: 'Pop' }) // artistA
      .mockResolvedValueOnce({ id: 'artist-b', name: 'Pop Star B', primaryGenre: 'Pop' }); // artistB
    // Both Pop artists fit in either Flex or Bench-1

    const res = await request(app)
      .put('/leagues/l1/roster/lineup')
      .send({ slotA: 'Flex', slotB: 'Bench-1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // $transaction should have been called to perform the 3-step swap
    expect(pm.$transaction).toHaveBeenCalledTimes(1);
    // rosterSpot.update called 3 times: null out slotA, set slotB→artistA, set slotA→artistB
    expect(pm.rosterSpot.update).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// GET /leagues — home-page league cards
// ---------------------------------------------------------------------------

describe('GET /leagues (league cards)', () => {
  const myTeam = {
    id: 't-cw', leagueId: 'l1', name: 'ChartWatcher', logoUrl: null, wins: 3, losses: 0,
    league: {
      id: 'l1', name: 'Chart Toppers 2026', status: 'active', currentWeek: 4,
      isPrivate: true, teamCount: 4, commissionerId: 'user-other',
      teams: [{ user: { username: 'cw', avatarUrl: null } }],
    },
  };

  it('fetches only the matchup involving the user\'s team', async () => {
    pm.team.findMany.mockResolvedValue([myTeam]);
    pm.matchup.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/leagues');
    expect(res.status).toBe(200);
    expect(pm.matchup.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leagueId: 'l1',
          week: 4,
          OR: [{ homeTeamId: 't-cw' }, { awayTeamId: 't-cw' }],
        }),
      })
    );
  });

  it('maps opponent and scores from the user\'s side of the matchup', async () => {
    pm.team.findMany.mockResolvedValue([myTeam]);
    // User's team is the away side of its own game
    pm.matchup.findFirst.mockResolvedValue({
      homeTeamId: 't-bb', awayTeamId: 't-cw', homeScore: 108, awayScore: 230,
      homeTeam: { id: 't-bb', name: 'BeatBroker', logoUrl: null },
      awayTeam: { id: 't-cw', name: 'ChartWatcher', logoUrl: null },
    });

    const res = await request(app).get('/leagues');
    expect(res.status).toBe(200);
    expect(res.body[0].opponent.name).toBe('BeatBroker');
    expect(res.body[0].myScore).toBe(230);
    expect(res.body[0].opponentScore).toBe(108);
  });
});
