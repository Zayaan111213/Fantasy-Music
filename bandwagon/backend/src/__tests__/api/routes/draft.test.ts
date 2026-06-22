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
    league: { findUnique: vi.fn() },
    draftPick: { findFirst: vi.fn(), create: vi.fn() },
    artist: { findUnique: vi.fn() },
    rosterSpot: { findUnique: vi.fn(), upsert: vi.fn() },
    draftState: { update: vi.fn() },
    team: { findMany: vi.fn() },
    matchup: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma: prismaMock };
});

import { prisma } from '../../../db/prisma';

const prismaMock = prisma as unknown as {
  league: { findUnique: ReturnType<typeof vi.fn> };
  draftPick: { findFirst: ReturnType<typeof vi.fn> };
  artist: { findUnique: ReturnType<typeof vi.fn> };
  rosterSpot: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  draftState: { update: ReturnType<typeof vi.fn> };
  team: { findMany: ReturnType<typeof vi.fn> };
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
});
