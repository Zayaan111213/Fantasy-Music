import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn() },
    artist: { findUnique: vi.fn(), findMany: vi.fn() },
    team: { findMany: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    rosterSpot: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    waiverClaim: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    tradeItem: { findMany: vi.fn() }, // lockedArtistIds
    notification: { createMany: vi.fn() },
    leagueEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../db/prisma';
import { submitWaiverClaim, cancelWaiverClaim, reorderWaiverClaims, resolveWaivers } from '../../waivers/engine';

const pm = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.resetAllMocks();
  // Defaults every test starts from; individual tests override as needed.
  // Handles both $transaction forms: interactive (callback) and batch (array).
  pm.$transaction.mockImplementation((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma));
  pm.artist.findMany.mockResolvedValue([]);
  pm.team.findMany.mockResolvedValue([]);
  pm.rosterSpot.findFirst.mockResolvedValue(null);
  pm.waiverClaim.findMany.mockResolvedValue([]);
  pm.waiverClaim.findFirst.mockResolvedValue(null);
  pm.waiverClaim.updateMany.mockResolvedValue({ count: 1 });
  pm.tradeItem.findMany.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// submitWaiverClaim
// ---------------------------------------------------------------------------

const LEAGUE = {
  id: 'league-1',
  status: 'active',
  teams: [{ id: 'team-1', userId: 'user-1', name: 'Chart Chasers' }],
};
const ARTIST_POP = { id: 'artist-pop', name: 'Pop Star', primaryGenre: 'Pop' };

describe('submitWaiverClaim', () => {
  it('creates a pending claim with a dropArtistId snapshot — no roster change', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findUnique.mockResolvedValue({ id: 'spot-1', artistId: 'old-artist', artist: { name: 'Old Timer' } });
    pm.waiverClaim.create.mockResolvedValue({ id: 'claim-1', artistId: 'artist-pop', dropSlot: 'Pop', status: 'pending' });

    const result = await submitWaiverClaim('league-1', 'user-1', 'artist-pop', 'Pop', 'Tuesday', '2026-07-08');

    expect(result).toEqual({ claim: { id: 'claim-1', artistId: 'artist-pop', dropSlot: 'Pop', status: 'pending' } });
    expect(pm.waiverClaim.create).toHaveBeenCalledWith({
      data: {
        leagueId: 'league-1',
        teamId: 'team-1',
        artistId: 'artist-pop',
        dropSlot: 'Pop',
        dropArtistId: 'old-artist',
        priority: 1, // first pending claim
      },
    });
    expect(pm.rosterSpot.update).not.toHaveBeenCalled();
    expect(pm.leagueEvent.create).not.toHaveBeenCalled();
  });

  it('appends new claims to the back of the team queue (priority = lowest + 1)', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findUnique.mockResolvedValue({ id: 'spot-1', artistId: 'old-artist', artist: { name: 'Old Timer' } });
    pm.waiverClaim.findFirst
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({ priority: 2 }); // lowest existing priority
    pm.waiverClaim.create.mockResolvedValue({ id: 'claim-3', artistId: 'artist-pop', dropSlot: 'Pop', status: 'pending' });

    await submitWaiverClaim('league-1', 'user-1', 'artist-pop', 'Pop', 'Tuesday', '2026-07-08');

    expect(pm.waiverClaim.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ priority: 3 }),
    });
  });

  it('404 when league not found', async () => {
    pm.league.findUnique.mockResolvedValue(null);
    expect(await submitWaiverClaim('bad', 'user-1', 'artist-pop', 'Pop', 'Tuesday', '2026-07-08')).toMatchObject({ status: 404 });
  });

  it('403 when user has no team in the league', async () => {
    pm.league.findUnique.mockResolvedValue({ ...LEAGUE, teams: [] });
    expect(await submitWaiverClaim('league-1', 'user-9', 'artist-pop', 'Pop', 'Tuesday', '2026-07-08')).toMatchObject({ status: 403 });
  });

  it('400 when league is not active', async () => {
    pm.league.findUnique.mockResolvedValue({ ...LEAGUE, status: 'pending' });
    expect(await submitWaiverClaim('league-1', 'user-1', 'artist-pop', 'Pop', 'Tuesday', '2026-07-08')).toMatchObject({ status: 400 });
  });

  it('404 when artist not found', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(null);
    expect(await submitWaiverClaim('league-1', 'user-1', 'artist-pop', 'Pop', 'Tuesday', '2026-07-08')).toMatchObject({ status: 404 });
  });

  it('400 when the artist is already rostered in the league', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findFirst.mockResolvedValue({ id: 'someone-elses-spot' });
    expect(await submitWaiverClaim('league-1', 'user-1', 'artist-pop', 'Pop', 'Tuesday', '2026-07-08')).toMatchObject({
      error: 'Pop Star is already on a roster', status: 400,
    });
  });

  it('400 when the target slot is invalid', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findUnique.mockResolvedValue(null);
    expect(await submitWaiverClaim('league-1', 'user-1', 'artist-pop', 'Pop', 'Tuesday', '2026-07-08')).toMatchObject({ status: 400 });
  });

  it('empty slot: queues a claim with no drop (dropArtistId null)', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findUnique.mockResolvedValue({ id: 'spot-1', artistId: null, artist: null });
    pm.waiverClaim.create.mockResolvedValue({ id: 'claim-1', artistId: 'artist-pop', dropSlot: 'Pop', status: 'pending' });

    const result = await submitWaiverClaim('league-1', 'user-1', 'artist-pop', 'Pop', 'Tuesday', '2026-07-08');

    expect(result).toEqual({ claim: { id: 'claim-1', artistId: 'artist-pop', dropSlot: 'Pop', status: 'pending' } });
    expect(pm.waiverClaim.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dropArtistId: null }),
    });
  });

  it('empty slot: Monday free agency adds instantly with no drop', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findUnique.mockResolvedValue({ id: 'spot-1', artistId: null, artist: null });

    const result = await submitWaiverClaim('league-1', 'user-1', 'artist-pop', 'Pop', 'Monday', '2026-07-06');

    expect(result).toEqual({
      success: true, instant: true, slot: 'Pop', droppedArtistId: null, addedArtistId: 'artist-pop',
    });
    expect(pm.rosterSpot.update).toHaveBeenCalledWith({ where: { id: 'spot-1' }, data: { artistId: 'artist-pop' } });
    expect(pm.leagueEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'claim',
        message: 'Chart Chasers added Pop Star to an empty slot (free agency)',
      }),
    });
  });

  it('400 with the trade-lock message when the drop artist is in an accepted trade', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findUnique.mockResolvedValue({ id: 'spot-1', artistId: 'old-artist', artist: { name: 'Old Timer' } });
    pm.tradeItem.findMany.mockResolvedValue([{ artistId: 'old-artist' }]);
    expect(await submitWaiverClaim('league-1', 'user-1', 'artist-pop', 'Pop', 'Tuesday', '2026-07-08')).toMatchObject({
      error: 'Old Timer is locked in an accepted trade', status: 400,
    });
  });

  it('400 when the artist is not eligible for the drop slot', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue({ ...ARTIST_POP, primaryGenre: 'Country' });
    pm.rosterSpot.findUnique.mockResolvedValue({ id: 'spot-1', artistId: 'old-artist', artist: { name: 'Old Timer' } });
    expect(await submitWaiverClaim('league-1', 'user-1', 'artist-pop', 'Pop', 'Tuesday', '2026-07-08')).toMatchObject({ status: 400 });
  });

  it('Monday free agency: pickup executes instantly, no claim, no demotion', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findUnique.mockResolvedValue({ id: 'spot-1', artistId: 'old-artist', artist: { name: 'Old Timer' } });

    const result = await submitWaiverClaim('league-1', 'user-1', 'artist-pop', 'Pop', 'Monday', '2026-07-06');

    expect(result).toEqual({
      success: true, instant: true, slot: 'Pop', droppedArtistId: 'old-artist', addedArtistId: 'artist-pop',
    });
    expect(pm.rosterSpot.update).toHaveBeenCalledWith({ where: { id: 'spot-1' }, data: { artistId: 'artist-pop' } });
    expect(pm.leagueEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'claim',
        message: 'Chart Chasers added Pop Star, dropped Old Timer (free agency)',
      }),
    });
    expect(pm.waiverClaim.create).not.toHaveBeenCalled();
    expect(pm.team.update).not.toHaveBeenCalled(); // free — waiver order untouched
  });

  it('week-1 pre-game window: pickups are instant on any day', async () => {
    pm.league.findUnique.mockResolvedValue({
      ...LEAGUE,
      currentWeek: 1,
      // Draft Wed 2026-07-08 → first scoring Tuesday 2026-07-14; today (Thu 07-09) is before it.
      draftTime: new Date('2026-07-08T19:00:00Z'),
    });
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findUnique.mockResolvedValue({ id: 'spot-1', artistId: 'old-artist', artist: { name: 'Old Timer' } });

    const result = await submitWaiverClaim('league-1', 'user-1', 'artist-pop', 'Pop', 'Thursday', '2026-07-09');

    expect(result).toMatchObject({ success: true, instant: true });
    expect(pm.waiverClaim.create).not.toHaveBeenCalled();
  });

  it('Tuesday–Sunday during a scoring week: pickups queue as waiver claims', async () => {
    pm.league.findUnique.mockResolvedValue({ ...LEAGUE, currentWeek: 3, draftTime: new Date('2026-06-17T19:00:00Z') });
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findUnique.mockResolvedValue({ id: 'spot-1', artistId: 'old-artist', artist: { name: 'Old Timer' } });
    pm.waiverClaim.create.mockResolvedValue({ id: 'claim-1', artistId: 'artist-pop', dropSlot: 'Pop', status: 'pending' });

    const result = await submitWaiverClaim('league-1', 'user-1', 'artist-pop', 'Pop', 'Saturday', '2026-07-11');

    expect(result).toMatchObject({ claim: expect.objectContaining({ status: 'pending' }) });
    expect(pm.rosterSpot.update).not.toHaveBeenCalled();
  });

  it('400 when the team already has a pending claim for the same artist', async () => {
    pm.league.findUnique.mockResolvedValue(LEAGUE);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    pm.rosterSpot.findUnique.mockResolvedValue({ id: 'spot-1', artistId: 'old-artist', artist: { name: 'Old Timer' } });
    pm.waiverClaim.findFirst.mockResolvedValue({ id: 'existing-claim' });
    expect(await submitWaiverClaim('league-1', 'user-1', 'artist-pop', 'Pop', 'Tuesday', '2026-07-08')).toMatchObject({
      error: 'You already have a pending claim for Pop Star', status: 400,
    });
    expect(pm.waiverClaim.create).not.toHaveBeenCalled();
  });
});

describe('cancelWaiverClaim', () => {
  it('cancels an own pending claim', async () => {
    pm.team.findFirst.mockResolvedValue({ id: 'team-1' });
    pm.waiverClaim.updateMany.mockResolvedValue({ count: 1 });
    expect(await cancelWaiverClaim('league-1', 'user-1', 'claim-1')).toEqual({ ok: true });
    expect(pm.waiverClaim.updateMany).toHaveBeenCalledWith({
      where: { id: 'claim-1', teamId: 'team-1', status: 'pending' },
      data: expect.objectContaining({ status: 'cancelled' }),
    });
  });

  it('404 when there is no pending claim to cancel', async () => {
    pm.team.findFirst.mockResolvedValue({ id: 'team-1' });
    pm.waiverClaim.updateMany.mockResolvedValue({ count: 0 });
    expect(await cancelWaiverClaim('league-1', 'user-1', 'claim-9')).toMatchObject({ status: 404 });
  });
});

describe('reorderWaiverClaims', () => {
  it('rewrites priorities 1..N in the given order', async () => {
    pm.team.findFirst.mockResolvedValue({ id: 'team-1' });
    pm.waiverClaim.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);

    const result = await reorderWaiverClaims('league-1', 'user-1', ['c3', 'c1', 'c2']);

    expect(result).toEqual({ ok: true });
    expect(pm.waiverClaim.update).toHaveBeenCalledWith({ where: { id: 'c3' }, data: { priority: 1 } });
    expect(pm.waiverClaim.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { priority: 2 } });
    expect(pm.waiverClaim.update).toHaveBeenCalledWith({ where: { id: 'c2' }, data: { priority: 3 } });
  });

  it('rejects a list that does not exactly match the pending set', async () => {
    pm.team.findFirst.mockResolvedValue({ id: 'team-1' });
    pm.waiverClaim.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

    // missing one
    expect(await reorderWaiverClaims('league-1', 'user-1', ['c1'])).toMatchObject({ status: 400 });
    // unknown id
    expect(await reorderWaiverClaims('league-1', 'user-1', ['c1', 'c9'])).toMatchObject({ status: 400 });
    // duplicate id
    expect(await reorderWaiverClaims('league-1', 'user-1', ['c1', 'c1'])).toMatchObject({ status: 400 });
    expect(pm.waiverClaim.update).not.toHaveBeenCalled();
  });

  it('403 for a non-member', async () => {
    pm.team.findFirst.mockResolvedValue(null);
    expect(await reorderWaiverClaims('league-1', 'user-9', ['c1'])).toMatchObject({ status: 403 });
  });
});

// ---------------------------------------------------------------------------
// resolveWaivers
// ---------------------------------------------------------------------------

function makeClaim(opts: {
  id: string; teamId: string; teamName: string; userId: string; priority: number;
  artistId: string; artistName: string; genre?: string; dropSlot: string; dropArtistId: string;
  createdAt?: Date;
}) {
  return {
    id: opts.id,
    leagueId: 'league-1',
    teamId: opts.teamId,
    artistId: opts.artistId,
    dropSlot: opts.dropSlot,
    dropArtistId: opts.dropArtistId,
    status: 'pending',
    createdAt: opts.createdAt ?? new Date('2026-07-08T10:00:00Z'),
    team: {
      id: opts.teamId, name: opts.teamName, userId: opts.userId,
      waiverPriority: opts.priority, createdAt: new Date('2026-06-01T00:00:00Z'),
    },
    artist: { id: opts.artistId, name: opts.artistName, primaryGenre: opts.genre ?? 'Pop' },
  };
}

// Mutable fake roster: rosterSpot.findUnique reads it, rosterSpot.update writes it,
// rosterSpot.findFirst answers "is this artist rostered anywhere in the league".
function fakeRoster(initial: Record<string, Record<string, string | null>>) {
  const roster = structuredClone(initial); // teamId → slot → artistId
  pm.rosterSpot.findUnique.mockImplementation(async (args: any) => {
    const { teamId, slot } = args.where.teamId_slot;
    if (!(slot in (roster[teamId] ?? {}))) return null;
    return { id: `${teamId}:${slot}`, teamId, slot, artistId: roster[teamId][slot] };
  });
  pm.rosterSpot.update.mockImplementation(async (args: any) => {
    const [teamId, slot] = (args.where.id as string).split(':');
    roster[teamId][slot] = args.data.artistId;
    return {};
  });
  pm.rosterSpot.findFirst.mockImplementation(async (args: any) => {
    const wanted = args.where.artistId;
    for (const [teamId, slots] of Object.entries(roster)) {
      for (const [slot, artistId] of Object.entries(slots)) {
        if (artistId === wanted) return { id: `${teamId}:${slot}` };
      }
    }
    return null;
  });
  return roster;
}

describe('resolveWaivers', () => {
  it('no pending claims → no-op', async () => {
    await resolveWaivers('league-1');
    expect(pm.$transaction).not.toHaveBeenCalled();
    expect(pm.team.update).not.toHaveBeenCalled();
  });

  it('single valid claim wins: swap, event, notification, winner demoted to bottom', async () => {
    pm.waiverClaim.findMany.mockResolvedValue([
      makeClaim({ id: 'c1', teamId: 't1', teamName: 'Alpha', userId: 'u1', priority: 1,
                  artistId: 'x', artistName: 'X', dropSlot: 'Pop', dropArtistId: 'old' }),
    ]);
    pm.team.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]); // ordered by priority: t1 first
    pm.artist.findMany.mockResolvedValue([{ id: 'old', name: 'Old Timer' }]);
    fakeRoster({ t1: { Pop: 'old' }, t2: {} });

    await resolveWaivers('league-1');

    expect(pm.waiverClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c1', status: 'pending' },
      data: expect.objectContaining({ status: 'won' }),
    }));
    expect(pm.rosterSpot.update).toHaveBeenCalledTimes(1);
    expect(pm.leagueEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'waiver_won',
        message: 'Alpha claimed X off waivers, dropped Old Timer',
      }),
    });
    expect(pm.notification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 'u1', leagueId: 'league-1', type: 'waiver_result' })],
    });
    // Winner drops to the bottom: t2 becomes 1, t1 becomes 2
    expect(pm.team.update).toHaveBeenCalledWith({ where: { id: 't2' }, data: { waiverPriority: 1 } });
    expect(pm.team.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { waiverPriority: 2 } });
  });

  it('priority conflict: higher waiver order wins, loser marked lost and notified', async () => {
    pm.waiverClaim.findMany.mockResolvedValue([
      makeClaim({ id: 'c-low', teamId: 't2', teamName: 'Beta', userId: 'u2', priority: 2,
                  artistId: 'x', artistName: 'X', dropSlot: 'Pop', dropArtistId: 'b-old',
                  createdAt: new Date('2026-07-08T09:00:00Z') }), // submitted earlier — still loses
      makeClaim({ id: 'c-high', teamId: 't1', teamName: 'Alpha', userId: 'u1', priority: 1,
                  artistId: 'x', artistName: 'X', dropSlot: 'Pop', dropArtistId: 'a-old' }),
    ]);
    pm.team.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    pm.artist.findMany.mockResolvedValue([{ id: 'a-old', name: 'A Old' }, { id: 'b-old', name: 'B Old' }]);
    fakeRoster({ t1: { Pop: 'a-old' }, t2: { Pop: 'b-old' } });

    await resolveWaivers('league-1');

    expect(pm.waiverClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c-high', status: 'pending' },
      data: expect.objectContaining({ status: 'won' }),
    }));
    expect(pm.waiverClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['c-low'] }, status: 'pending' },
      data: expect.objectContaining({
        status: 'lost',
        resolution: 'Lost to Alpha (higher waiver priority)',
      }),
    }));
    expect(pm.notification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 'u2', message: expect.stringContaining('lost to Alpha') })],
    });
    // Only one roster swap happened
    expect(pm.rosterSpot.update).toHaveBeenCalledTimes(1);
  });

  it('winner drops to bottom mid-run: A wins X then loses the Y conflict to B', async () => {
    pm.waiverClaim.findMany.mockResolvedValue([
      makeClaim({ id: 'a-x', teamId: 't1', teamName: 'Alpha', userId: 'u1', priority: 1,
                  artistId: 'x', artistName: 'X', dropSlot: 'Pop', dropArtistId: 'a1',
                  createdAt: new Date('2026-07-08T09:00:00Z') }),
      makeClaim({ id: 'a-y', teamId: 't1', teamName: 'Alpha', userId: 'u1', priority: 1,
                  artistId: 'y', artistName: 'Y', dropSlot: 'Flex', dropArtistId: 'a2',
                  createdAt: new Date('2026-07-08T09:30:00Z') }),
      makeClaim({ id: 'b-y', teamId: 't2', teamName: 'Beta', userId: 'u2', priority: 2,
                  artistId: 'y', artistName: 'Y', dropSlot: 'Pop', dropArtistId: 'b1',
                  createdAt: new Date('2026-07-08T10:00:00Z') }),
    ]);
    pm.team.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    pm.artist.findMany.mockResolvedValue([
      { id: 'a1', name: 'A1' }, { id: 'a2', name: 'A2' }, { id: 'b1', name: 'B1' },
    ]);
    fakeRoster({ t1: { Pop: 'a1', Flex: 'a2' }, t2: { Pop: 'b1' } });

    await resolveWaivers('league-1');

    // A won X; after dropping to the bottom, B outranks A for the Y conflict.
    expect(pm.waiverClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'a-x', status: 'pending' },
      data: expect.objectContaining({ status: 'won' }),
    }));
    expect(pm.waiverClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'b-y', status: 'pending' },
      data: expect.objectContaining({ status: 'won' }),
    }));
    expect(pm.waiverClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['a-y'] }, status: 'pending' },
      data: expect.objectContaining({ status: 'lost', resolution: 'Lost to Beta (higher waiver priority)' }),
    }));
    expect(pm.rosterSpot.update).toHaveBeenCalledTimes(2);
  });

  it('stale drop slot: a second claim reusing the same slot goes invalid', async () => {
    pm.waiverClaim.findMany.mockResolvedValue([
      makeClaim({ id: 'c1', teamId: 't1', teamName: 'Alpha', userId: 'u1', priority: 1,
                  artistId: 'x', artistName: 'X', dropSlot: 'Pop', dropArtistId: 'old',
                  createdAt: new Date('2026-07-08T09:00:00Z') }),
      makeClaim({ id: 'c2', teamId: 't1', teamName: 'Alpha', userId: 'u1', priority: 1,
                  artistId: 'y', artistName: 'Y', dropSlot: 'Pop', dropArtistId: 'old',
                  createdAt: new Date('2026-07-08T09:30:00Z') }),
    ]);
    pm.team.findMany.mockResolvedValue([{ id: 't1' }]);
    pm.artist.findMany.mockResolvedValue([{ id: 'old', name: 'Old Timer' }]);
    fakeRoster({ t1: { Pop: 'old' } });

    await resolveWaivers('league-1');

    // c1 won and put X in the Pop slot; c2's dropArtistId no longer matches.
    expect(pm.waiverClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c2', status: 'pending' },
      data: expect.objectContaining({
        status: 'invalid',
        resolution: 'your roster changed since the claim was submitted',
      }),
    }));
    expect(pm.rosterSpot.update).toHaveBeenCalledTimes(1);
  });

  it('artist no longer a free agent → invalid, no roster writes', async () => {
    pm.waiverClaim.findMany.mockResolvedValue([
      makeClaim({ id: 'c1', teamId: 't1', teamName: 'Alpha', userId: 'u1', priority: 1,
                  artistId: 'x', artistName: 'X', dropSlot: 'Pop', dropArtistId: 'old' }),
    ]);
    pm.team.findMany.mockResolvedValue([{ id: 't1' }]);
    pm.artist.findMany.mockResolvedValue([{ id: 'old', name: 'Old Timer' }]);
    fakeRoster({ t1: { Pop: 'old' }, t2: { Flex: 'x' } }); // X already rostered on t2

    await resolveWaivers('league-1');

    expect(pm.rosterSpot.update).not.toHaveBeenCalled();
    expect(pm.leagueEvent.create).not.toHaveBeenCalled();
    expect(pm.team.update).not.toHaveBeenCalled(); // no win → order untouched
    expect(pm.waiverClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c1', status: 'pending' },
      data: expect.objectContaining({ status: 'invalid', resolution: 'X is no longer a free agent' }),
    }));
    expect(pm.notification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 'u1', message: expect.stringContaining('could not be processed') })],
    });
  });

  it('every pickup demotes the winner: the order is rewritten after EACH win', async () => {
    // A (order 1) and B (order 2) each win an uncontested claim. After A's
    // win the persisted order must already read [B, A] — before B's claim is
    // even processed — and after B's win it flips back to [A, B].
    pm.waiverClaim.findMany.mockResolvedValue([
      makeClaim({ id: 'a-x', teamId: 't1', teamName: 'Alpha', userId: 'u1', priority: 1,
                  artistId: 'x', artistName: 'X', dropSlot: 'Pop', dropArtistId: 'a1',
                  createdAt: new Date('2026-07-08T09:00:00Z') }),
      makeClaim({ id: 'b-y', teamId: 't2', teamName: 'Beta', userId: 'u2', priority: 1,
                  artistId: 'y', artistName: 'Y', dropSlot: 'Pop', dropArtistId: 'b1',
                  createdAt: new Date('2026-07-08T10:00:00Z') }),
    ]);
    pm.team.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    pm.artist.findMany.mockResolvedValue([{ id: 'a1', name: 'A1' }, { id: 'b1', name: 'B1' }]);
    fakeRoster({ t1: { Pop: 'a1' }, t2: { Pop: 'b1' } });

    await resolveWaivers('league-1');

    // team.update is called once per team per win (2 wins × 2 teams = 4 calls),
    // in demotion order each time.
    expect(pm.team.update.mock.calls.map((c: any[]) => [c[0].where.id, c[0].data.waiverPriority])).toEqual([
      ['t2', 1], ['t1', 2], // after A's win: A dropped to the bottom
      ['t1', 1], ['t2', 2], // after B's win: B dropped to the bottom
    ]);
  });

  it("respects each team's own claim priority over submission time", async () => {
    // A's user-set #1 is Y (submitted later); A's #2 is X (submitted first).
    // B (waiver order 2) also claims X. A wins Y first (their #1), drops to
    // the bottom, and B takes X — which A would have won under createdAt order.
    // findMany returns claims in DB order: [priority asc, createdAt asc].
    pm.waiverClaim.findMany.mockResolvedValue([
      makeClaim({ id: 'a-y', teamId: 't1', teamName: 'Alpha', userId: 'u1', priority: 1,
                  artistId: 'y', artistName: 'Y', dropSlot: 'Flex', dropArtistId: 'a2',
                  createdAt: new Date('2026-07-08T10:00:00Z') }), // A's claim priority 1
      makeClaim({ id: 'b-x', teamId: 't2', teamName: 'Beta', userId: 'u2', priority: 1,
                  artistId: 'x', artistName: 'X', dropSlot: 'Pop', dropArtistId: 'b1',
                  createdAt: new Date('2026-07-08T11:00:00Z') }), // B's claim priority 1
      makeClaim({ id: 'a-x', teamId: 't1', teamName: 'Alpha', userId: 'u1', priority: 2,
                  artistId: 'x', artistName: 'X', dropSlot: 'Pop', dropArtistId: 'a1',
                  createdAt: new Date('2026-07-08T09:00:00Z') }), // A's claim priority 2, oldest
    ]);
    pm.team.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    pm.artist.findMany.mockResolvedValue([
      { id: 'a1', name: 'A1' }, { id: 'a2', name: 'A2' }, { id: 'b1', name: 'B1' },
    ]);
    fakeRoster({ t1: { Pop: 'a1', Flex: 'a2' }, t2: { Pop: 'b1' } });

    await resolveWaivers('league-1');

    expect(pm.waiverClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'a-y', status: 'pending' },
      data: expect.objectContaining({ status: 'won' }),
    }));
    expect(pm.waiverClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'b-x', status: 'pending' },
      data: expect.objectContaining({ status: 'won' }),
    }));
    expect(pm.waiverClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['a-x'] }, status: 'pending' },
      data: expect.objectContaining({ status: 'lost' }),
    }));
  });

  it('claim into an empty slot: wins with no drop, message and notification say so', async () => {
    pm.waiverClaim.findMany.mockResolvedValue([
      makeClaim({ id: 'c1', teamId: 't1', teamName: 'Alpha', userId: 'u1', priority: 1,
                  artistId: 'x', artistName: 'X', dropSlot: 'Bench1', dropArtistId: null as unknown as string }),
    ]);
    pm.team.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    pm.artist.findMany.mockResolvedValue([]);
    fakeRoster({ t1: { Bench1: null }, t2: {} });

    await resolveWaivers('league-1');

    expect(pm.rosterSpot.update).toHaveBeenCalledTimes(1);
    expect(pm.leagueEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'waiver_won',
        message: 'Alpha claimed X off waivers into an empty slot',
      }),
    });
    expect(pm.notification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        userId: 'u1',
        message: 'Your waiver claim went through: you added X to an empty roster slot.',
      })],
    });
  });

  it('gate count=0 (concurrent/repeated run) → no side effects at all', async () => {
    pm.waiverClaim.findMany.mockResolvedValue([
      makeClaim({ id: 'c1', teamId: 't1', teamName: 'Alpha', userId: 'u1', priority: 1,
                  artistId: 'x', artistName: 'X', dropSlot: 'Pop', dropArtistId: 'old' }),
    ]);
    pm.team.findMany.mockResolvedValue([{ id: 't1' }]);
    pm.waiverClaim.updateMany.mockResolvedValue({ count: 0 });
    fakeRoster({ t1: { Pop: 'old' } });

    await resolveWaivers('league-1');

    expect(pm.rosterSpot.update).not.toHaveBeenCalled();
    expect(pm.leagueEvent.create).not.toHaveBeenCalled();
    expect(pm.notification.createMany).not.toHaveBeenCalled();
    expect(pm.team.update).not.toHaveBeenCalled();
  });
});
