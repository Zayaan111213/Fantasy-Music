import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isEligible, makePick } from '../../../api/routes/draft';

// ---------------------------------------------------------------------------
// isEligible — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe('isEligible', () => {
  it('allows any genre in Bench slots', () => {
    expect(isEligible('Pop', 'Bench-1')).toBe(true);
    expect(isEligible('Country', 'Bench-2')).toBe(true);
    expect(isEligible('Latin', 'Bench-3')).toBe(true);
  });

  it('allows any genre in the Flex slot', () => {
    expect(isEligible('R&B/Hip-Hop', 'Flex')).toBe(true);
    expect(isEligible('Rock & Alternative', 'Flex')).toBe(true);
    expect(isEligible('Afrobeats', 'Flex')).toBe(true);
  });

  it('allows matching genre in a named genre slot', () => {
    expect(isEligible('Pop', 'Pop')).toBe(true);
    expect(isEligible('Country', 'Country')).toBe(true);
    expect(isEligible('R&B/Hip-Hop', 'R&B/Hip-Hop')).toBe(true);
    expect(isEligible('Rock & Alternative', 'Rock & Alternative')).toBe(true);
  });

  it('rejects non-matching genre in a named genre slot', () => {
    expect(isEligible('Pop', 'Country')).toBe(false);
    expect(isEligible('R&B/Hip-Hop', 'Pop')).toBe(false);
    expect(isEligible('Rock & Alternative', 'R&B/Hip-Hop')).toBe(false);
  });

  it('allows non-main genres in the Other slot', () => {
    expect(isEligible('Latin', 'Other')).toBe(true);
    expect(isEligible('Afrobeats', 'Other')).toBe(true);
    expect(isEligible('K-Pop', 'Other')).toBe(true);
  });

  it('rejects main genres in the Other slot', () => {
    expect(isEligible('Pop', 'Other')).toBe(false);
    expect(isEligible('R&B/Hip-Hop', 'Other')).toBe(false);
    expect(isEligible('Rock & Alternative', 'Other')).toBe(false);
    expect(isEligible('Country', 'Other')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// makePick — mocked Prisma
// ---------------------------------------------------------------------------

vi.mock('../../../db/prisma', () => {
  const prismaMock = {
    league: { findUnique: vi.fn(), update: vi.fn() },
    draftPick: { findFirst: vi.fn(), create: vi.fn() },
    artist: { findUnique: vi.fn() },
    rosterSpot: { findUnique: vi.fn(), upsert: vi.fn() },
    draftState: { update: vi.fn() },
    team: { findMany: vi.fn(), update: vi.fn() },
    matchup: { createMany: vi.fn() },
    leagueEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma: prismaMock };
});

import { prisma } from '../../../db/prisma';

const prismaMock = prisma as unknown as {
  league: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  draftPick: { findFirst: ReturnType<typeof vi.fn> };
  artist: { findUnique: ReturnType<typeof vi.fn> };
  rosterSpot: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  draftState: { update: ReturnType<typeof vi.fn> };
  team: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  matchup: { createMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function baseLeague(overrides = {}) {
  return {
    id: 'league-1',
    status: 'drafting',
    teamCount: 2,
    draftState: {
      currentPick: 0,
      pickOrder: ['team-1', 'team-2', 'team-2', 'team-1'],
      isComplete: false,
    },
    teams: [
      { id: 'team-1', userId: 'user-1', draftPosition: 1 },
      { id: 'team-2', userId: 'user-2', draftPosition: 2 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('makePick', () => {
  it('returns error when league status is not drafting', async () => {
    prismaMock.league.findUnique.mockResolvedValue(baseLeague({ status: 'pending' }));
    const result = await makePick('league-1', 'user-1', 'artist-1', 'Pop', false);
    expect(result).toEqual({ error: 'Draft is not active' });
  });

  it('returns error when draftState is missing', async () => {
    prismaMock.league.findUnique.mockResolvedValue({ ...baseLeague(), draftState: null });
    const result = await makePick('league-1', 'user-1', 'artist-1', 'Pop', false);
    expect(result).toEqual({ error: 'Draft not found' });
  });

  it('returns error when draft is already complete', async () => {
    prismaMock.league.findUnique.mockResolvedValue(
      baseLeague({ draftState: { currentPick: 0, pickOrder: ['team-1'], isComplete: true } })
    );
    const result = await makePick('league-1', 'user-1', 'artist-1', 'Pop', false);
    expect(result).toEqual({ error: 'Draft is complete' });
  });

  it('returns error when it is not the user\'s turn', async () => {
    prismaMock.league.findUnique.mockResolvedValue(baseLeague());
    const result = await makePick('league-1', 'user-2', 'artist-1', 'Pop', false);
    expect(result).toEqual({ error: 'It is not your turn' });
  });

  it('allows auto-draft even when it is not the user\'s turn', async () => {
    prismaMock.league.findUnique.mockResolvedValue(baseLeague());
    prismaMock.draftPick.findFirst.mockResolvedValue(null);
    prismaMock.artist.findUnique.mockResolvedValue({ id: 'artist-1', name: 'Test Artist', primaryGenre: 'Pop' });
    prismaMock.rosterSpot.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (fn: Function) => fn(prismaMock));
    prismaMock.draftPick.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'pick-1',
      artist: { id: 'artist-1', name: 'Test Artist', primaryGenre: 'Pop', imageUrl: null },
      team: { id: 'team-1', name: 'Team 1', logoUrl: null },
    });
    const result = await makePick('league-1', 'user-2', 'artist-1', 'Pop', true);
    expect('error' in result).toBe(false);
  });

  it('returns error when artist is already drafted', async () => {
    prismaMock.league.findUnique.mockResolvedValue(baseLeague());
    prismaMock.draftPick.findFirst.mockResolvedValue({ id: 'existing-pick' });
    const result = await makePick('league-1', 'user-1', 'artist-1', 'Pop', false);
    expect(result).toEqual({ error: 'Artist already drafted' });
  });

  it('returns error when artist is not found', async () => {
    prismaMock.league.findUnique.mockResolvedValue(baseLeague());
    prismaMock.draftPick.findFirst.mockResolvedValue(null);
    prismaMock.artist.findUnique.mockResolvedValue(null);
    const result = await makePick('league-1', 'user-1', 'artist-1', 'Pop', false);
    expect(result).toEqual({ error: 'Artist not found' });
  });

  it('returns error when genre does not match slot', async () => {
    prismaMock.league.findUnique.mockResolvedValue(baseLeague());
    prismaMock.draftPick.findFirst.mockResolvedValue(null);
    prismaMock.artist.findUnique.mockResolvedValue({ id: 'artist-1', name: 'Country Star', primaryGenre: 'Country' });
    const result = await makePick('league-1', 'user-1', 'artist-1', 'Pop', false);
    expect(result).toEqual({ error: 'Country Star is not eligible for the Pop slot' });
  });

  it('returns error when roster slot is already filled', async () => {
    prismaMock.league.findUnique.mockResolvedValue(baseLeague());
    prismaMock.draftPick.findFirst.mockResolvedValue(null);
    prismaMock.artist.findUnique.mockResolvedValue({ id: 'artist-1', name: 'Pop Star', primaryGenre: 'Pop' });
    prismaMock.rosterSpot.findUnique.mockResolvedValue({ artistId: 'other-artist' });
    const result = await makePick('league-1', 'user-1', 'artist-1', 'Pop', false);
    expect(result).toEqual({ error: 'Pop slot already filled' });
  });

  it('returns pick and isComplete:false on a happy-path pick', async () => {
    prismaMock.league.findUnique.mockResolvedValue(baseLeague());
    prismaMock.draftPick.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'pick-1',
        artist: { id: 'artist-1', name: 'Pop Star', primaryGenre: 'Pop', imageUrl: null },
        team: { id: 'team-1', name: 'Team 1', logoUrl: null },
      });
    prismaMock.artist.findUnique.mockResolvedValue({ id: 'artist-1', name: 'Pop Star', primaryGenre: 'Pop' });
    prismaMock.rosterSpot.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (fn: Function) => fn(prismaMock));

    const result = await makePick('league-1', 'user-1', 'artist-1', 'Pop', false);
    expect(result).toMatchObject({ isComplete: false });
    expect('pick' in result).toBe(true);
  });

  it('completion branch: sets league active, creates 10 matchups (2 teams × 10 weeks), inits all roster slots', async () => {
    // 2 teams × 9 slots = 18 total picks; currentPick=17 → last pick → isComplete=true
    // Snake order (2 teams, 9 rounds): [t1,t2, t2,t1, t1,t2, t2,t1, t1,t2, t2,t1, t1,t2, t2,t1, t1,t2]
    // pickOrder[17] = 't2' → call with 'u2'
    const pickOrder = ['t1','t2','t2','t1','t1','t2','t2','t1','t1','t2','t2','t1','t1','t2','t2','t1','t1','t2'];
    prismaMock.league.findUnique.mockResolvedValue({
      id: 'league-1',
      status: 'drafting',
      teamCount: 2,
      draftState: { currentPick: 17, pickOrder, isComplete: false },
      teams: [
        { id: 't1', userId: 'u1', draftPosition: 1 },
        { id: 't2', userId: 'u2', draftPosition: 2 },
      ],
    });
    prismaMock.draftPick.findFirst
      .mockResolvedValueOnce(null) // not already drafted
      .mockResolvedValueOnce({    // returned pick after tx
        id: 'pick-18',
        artist: { id: 'artist-1', name: 'Pop Star', primaryGenre: 'Pop', imageUrl: null },
        team: { id: 't2', name: "Team 2's Squad", logoUrl: null },
      });
    prismaMock.artist.findUnique.mockResolvedValue({ id: 'artist-1', name: 'Pop Star', primaryGenre: 'Pop' });
    prismaMock.rosterSpot.findUnique.mockResolvedValue(null);
    prismaMock.team.findMany.mockResolvedValue([
      { id: 't1', draftPosition: 1 },
      { id: 't2', draftPosition: 2 },
    ]);
    prismaMock.$transaction.mockImplementation(async (fn: Function) => fn(prismaMock));

    const result = await makePick('league-1', 'u2', 'artist-1', 'Pop', false);

    expect('error' in result).toBe(false);
    expect((result as { isComplete: boolean }).isComplete).toBe(true);

    // League set to active with week 1
    expect(prismaMock.league.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'active', currentWeek: 1 } })
    );

    // 10-week round-robin for 2 teams = 10 matchups
    expect(prismaMock.matchup.createMany).toHaveBeenCalledTimes(1);
    const matchupData = prismaMock.matchup.createMany.mock.calls[0][0].data;
    expect(matchupData).toHaveLength(10); // 2 teams → 1 matchup/week × 10 weeks

    // Roster slot init: 1 pick upsert + 9 slots × 2 teams = 19 total
    expect(prismaMock.rosterSpot.upsert.mock.calls.length).toBeGreaterThanOrEqual(19);

    // Waiver order seeded as reverse draft order: last pick gets priority 1
    expect(prismaMock.team.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { waiverPriority: 2 } });
    expect(prismaMock.team.update).toHaveBeenCalledWith({ where: { id: 't2' }, data: { waiverPriority: 1 } });
  });
});
