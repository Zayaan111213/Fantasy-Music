import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isLineupLocked, artistEligibleForSlot, claimFreeAgent } from '../../../api/routes/leagues';

vi.mock('../../../db/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn() },
    artist: { findUnique: vi.fn() },
    rosterSpot: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    tradeItem: { findMany: vi.fn().mockResolvedValue([]) },
    leagueEvent: { create: vi.fn() },
  },
}));

import { prisma } from '../../../db/prisma';

const pm = prisma as unknown as {
  league: { findUnique: ReturnType<typeof vi.fn> };
  artist: { findUnique: ReturnType<typeof vi.fn> };
  rosterSpot: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  leagueEvent: { create: ReturnType<typeof vi.fn> };
};

// All draft times use 19:00 UTC = noon PT (PDT, UTC-7) to avoid date-boundary ambiguity.
// Calendar reference (2026): Mon=June15, Tue=16, Wed=17, Thu=18, Fri=19, Sat=20, Sun=21,
//                             Mon=22, Tue=23, Wed=24, Thu=25, Fri=26, Sat=27, Sun=28

describe('isLineupLocked', () => {
  describe('Monday is always unlocked', () => {
    it('returns false on Monday regardless of week', () => {
      expect(isLineupLocked('Monday', 2, null, '2026-06-22')).toBe(false);
    });

    it('returns false on Monday even in week 1 with no draftTime', () => {
      expect(isLineupLocked('Monday', 1, null, '2026-06-22')).toBe(false);
    });
  });

  describe('normal scoring week (week ≥ 2, no pre-game exception)', () => {
    it('returns true on Tuesday', () => {
      expect(isLineupLocked('Tuesday', 2, null, '2026-06-23')).toBe(true);
    });

    it('returns true on Wednesday', () => {
      expect(isLineupLocked('Wednesday', 2, null, '2026-06-24')).toBe(true);
    });

    it('returns true on Saturday', () => {
      expect(isLineupLocked('Saturday', 2, null, '2026-06-27')).toBe(true);
    });

    it('returns true on Sunday', () => {
      expect(isLineupLocked('Sunday', 2, null, '2026-06-28')).toBe(true);
    });
  });

  describe('week-1 pre-game window (before first Tuesday after draft)', () => {
    it('unlocks when draft was Wednesday and today is Thursday', () => {
      // Draft: Wed June 17 → first Tuesday: June 23
      const draftTime = new Date('2026-06-17T19:00:00Z');
      expect(isLineupLocked('Thursday', 1, draftTime, '2026-06-18')).toBe(false);
    });

    it('unlocks when draft was Wednesday and today is Saturday', () => {
      const draftTime = new Date('2026-06-17T19:00:00Z');
      expect(isLineupLocked('Saturday', 1, draftTime, '2026-06-20')).toBe(false);
    });

    it('locks exactly on the first Tuesday after a Wednesday draft', () => {
      const draftTime = new Date('2026-06-17T19:00:00Z');
      expect(isLineupLocked('Tuesday', 1, draftTime, '2026-06-23')).toBe(true);
    });

    it('unlocks when draft was on Tuesday and today is Wednesday (7-day window)', () => {
      // Draft on Tuesday June 16 → first game Tuesday June 23 (7 days later)
      const draftTime = new Date('2026-06-16T19:00:00Z');
      expect(isLineupLocked('Wednesday', 1, draftTime, '2026-06-17')).toBe(false);
    });

    it('locks on the next Tuesday after a Tuesday draft', () => {
      const draftTime = new Date('2026-06-16T19:00:00Z');
      expect(isLineupLocked('Tuesday', 1, draftTime, '2026-06-23')).toBe(true);
    });

    it('unlocks when draft was Friday and today is Saturday (3-day window)', () => {
      // Draft: Fri June 19 → first Tuesday: June 23
      const draftTime = new Date('2026-06-19T19:00:00Z');
      expect(isLineupLocked('Saturday', 1, draftTime, '2026-06-20')).toBe(false);
    });

    it('locks on first Tuesday after a Friday draft', () => {
      const draftTime = new Date('2026-06-19T19:00:00Z');
      expect(isLineupLocked('Tuesday', 1, draftTime, '2026-06-23')).toBe(true);
    });
  });

  describe('week-1 exception does not apply when draftTime is missing', () => {
    it('returns true on Thursday in week 1 with no draftTime', () => {
      expect(isLineupLocked('Thursday', 1, null, '2026-06-18')).toBe(true);
    });
  });

  describe('week-1 exception does not apply in week 2+', () => {
    it('returns true on Thursday in week 2 even if draftTime is set', () => {
      // Would have been the pre-game window in week 1, but week is 2 now
      const draftTime = new Date('2026-06-17T19:00:00Z');
      expect(isLineupLocked('Thursday', 2, draftTime, '2026-06-18')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// artistEligibleForSlot — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe('artistEligibleForSlot', () => {
  it('always allows Bench slots regardless of genre', () => {
    expect(artistEligibleForSlot('Pop', 'Bench-1')).toBe(true);
    expect(artistEligibleForSlot('Country', 'Bench-2')).toBe(true);
    expect(artistEligibleForSlot(null, 'Bench-3')).toBe(true);
  });

  it('always allows the Flex slot regardless of genre', () => {
    expect(artistEligibleForSlot('R&B/Hip-Hop', 'Flex')).toBe(true);
    expect(artistEligibleForSlot('Latin', 'Flex')).toBe(true);
    expect(artistEligibleForSlot(null, 'Flex')).toBe(true);
  });

  it('allows matching genre in named genre slots', () => {
    expect(artistEligibleForSlot('Pop', 'Pop')).toBe(true);
    expect(artistEligibleForSlot('Country', 'Country')).toBe(true);
    expect(artistEligibleForSlot('R&B/Hip-Hop', 'R&B/Hip-Hop')).toBe(true);
    expect(artistEligibleForSlot('Rock & Alternative', 'Rock & Alternative')).toBe(true);
  });

  it('rejects non-matching genre in named genre slots', () => {
    expect(artistEligibleForSlot('Pop', 'Country')).toBe(false);
    expect(artistEligibleForSlot('R&B/Hip-Hop', 'Pop')).toBe(false);
    expect(artistEligibleForSlot('Country', 'Rock & Alternative')).toBe(false);
  });

  it('rejects null genre in named genre slots', () => {
    expect(artistEligibleForSlot(null, 'Pop')).toBe(false);
    expect(artistEligibleForSlot(null, 'Country')).toBe(false);
  });

  it('Other slot accepts non-main genres', () => {
    expect(artistEligibleForSlot('Latin', 'Other')).toBe(true);
    expect(artistEligibleForSlot('Afrobeats', 'Other')).toBe(true);
    expect(artistEligibleForSlot('K-Pop', 'Other')).toBe(true);
    expect(artistEligibleForSlot('Dance', 'Other')).toBe(true);
  });

  it('Other slot rejects main genres', () => {
    expect(artistEligibleForSlot('Pop', 'Other')).toBe(false);
    expect(artistEligibleForSlot('R&B/Hip-Hop', 'Other')).toBe(false);
    expect(artistEligibleForSlot('Rock & Alternative', 'Other')).toBe(false);
    expect(artistEligibleForSlot('Country', 'Other')).toBe(false);
  });

  it('Other slot rejects null genre', () => {
    expect(artistEligibleForSlot(null, 'Other')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// claimFreeAgent — mocked Prisma
// ---------------------------------------------------------------------------

const LEAGUE = {
  id: 'league-1',
  status: 'active',
  teams: [{ id: 'team-1', userId: 'user-1', name: 'Chart Chasers' }],
};

const ARTIST_POP = { id: 'artist-pop', name: 'Pop Star', primaryGenre: 'Pop' };
const ARTIST_COUNTRY = { id: 'artist-country', name: 'Country Star', primaryGenre: 'Country' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('claimFreeAgent', () => {
  it('happy path: swaps artist into the drop slot', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findFirst.mockResolvedValue(null); // not rostered
    pm.rosterSpot.findUnique.mockResolvedValue({ id: 'spot-1', artistId: 'old-artist', artist: { name: 'Old Timer' } });
    pm.rosterSpot.update.mockResolvedValue({});

    const result = await claimFreeAgent('league-1', 'user-1', 'artist-pop', 'Pop');

    expect(result).toEqual({ success: true, slot: 'Pop', droppedArtistId: 'old-artist', addedArtistId: 'artist-pop' });
    expect(pm.rosterSpot.update).toHaveBeenCalledWith({
      where: { id: 'spot-1' },
      data: { artistId: 'artist-pop' },
    });
    expect(pm.leagueEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leagueId: 'league-1',
        type: 'claim',
        message: 'Chart Chasers added Pop Star, dropped Old Timer',
      }),
    });
  });

  it('returns 404 when league not found', async () => {
    pm.league.findUnique.mockResolvedValue(null);
    const result = await claimFreeAgent('bad-league', 'user-1', 'artist-pop', 'Pop');
    expect(result).toMatchObject({ error: 'League not found', status: 404 });
  });

  it('returns 403 when user is not in the league', async () => {
    pm.league.findUnique.mockResolvedValue({ ...LEAGUE, teams: [] });
    const result = await claimFreeAgent('league-1', 'user-9', 'artist-pop', 'Pop');
    expect(result).toMatchObject({ error: 'You are not in this league', status: 403 });
  });

  it('returns 400 when league is not active', async () => {
    pm.league.findUnique.mockResolvedValue({ ...LEAGUE, status: 'pending' });
    const result = await claimFreeAgent('league-1', 'user-1', 'artist-pop', 'Pop');
    expect(result).toMatchObject({ status: 400 });
  });

  it('returns 404 when artist not found', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(null);
    const result = await claimFreeAgent('league-1', 'user-1', 'artist-pop', 'Pop');
    expect(result).toMatchObject({ error: 'Artist not found', status: 404 });
  });

  it('returns 400 when artist is already rostered', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findFirst.mockResolvedValue({ id: 'spot-x' }); // already rostered
    const result = await claimFreeAgent('league-1', 'user-1', 'artist-pop', 'Pop');
    expect(result).toMatchObject({ error: 'Pop Star is already on a roster', status: 400 });
  });

  it('returns 400 when drop slot does not exist', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findFirst.mockResolvedValue(null);
    pm.rosterSpot.findUnique.mockResolvedValue(null);
    const result = await claimFreeAgent('league-1', 'user-1', 'artist-pop', 'Pop');
    expect(result).toMatchObject({ error: 'Invalid slot', status: 400 });
  });

  it('returns 400 when drop slot is already empty', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findFirst.mockResolvedValue(null);
    pm.rosterSpot.findUnique.mockResolvedValue({ id: 'spot-1', artistId: null, artist: null });
    const result = await claimFreeAgent('league-1', 'user-1', 'artist-pop', 'Pop');
    expect(result).toMatchObject({ error: 'That slot is already empty', status: 400 });
  });

  it('returns 400 when artist genre does not match slot', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(ARTIST_COUNTRY);
    pm.rosterSpot.findFirst.mockResolvedValue(null);
    pm.rosterSpot.findUnique.mockResolvedValue({ id: 'spot-1', artistId: 'old-artist', artist: null });
    const result = await claimFreeAgent('league-1', 'user-1', 'artist-country', 'Pop');
    expect(result).toMatchObject({ error: 'Country Star is not eligible for the Pop slot', status: 400 });
  });
});
