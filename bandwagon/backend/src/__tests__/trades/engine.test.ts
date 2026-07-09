import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma', () => ({
  prisma: {
    trade: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    tradeItem: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    rosterSpot: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    team: { findMany: vi.fn().mockResolvedValue([]) },
    notification: { createMany: vi.fn() },
    leagueEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../db/prisma';
import {
  assignRoster,
  requiredDropCount,
  sidesFromItems,
  executeAcceptedTrades,
  cancelPendingTradesAtDeadline,
  type RosterArtist,
} from '../../trades/engine';

const ALL_SLOTS = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Other', 'Flex', 'Bench-1', 'Bench-2', 'Bench-3'];

const a = (id: string, primaryGenre: string): RosterArtist => ({ id, primaryGenre });

describe('requiredDropCount', () => {
  it('even trades on a full roster need no drops', () => {
    expect(requiredDropCount(9, 1, 1)).toBe(0);
    expect(requiredDropCount(9, 2, 2)).toBe(0);
  });

  it('net gain on a full roster needs one drop per extra player', () => {
    expect(requiredDropCount(9, 1, 2)).toBe(1);
    expect(requiredDropCount(9, 1, 3)).toBe(2);
  });

  it('net loss never needs drops', () => {
    expect(requiredDropCount(9, 2, 1)).toBe(0);
  });

  it('existing empty slots absorb incoming players', () => {
    expect(requiredDropCount(8, 1, 2)).toBe(0);
    expect(requiredDropCount(7, 1, 3)).toBe(0);
    expect(requiredDropCount(8, 1, 3)).toBe(1);
  });
});

describe('assignRoster', () => {
  it('places an incoming artist into its vacated genre slot', () => {
    const keep = [
      { slot: 'R&B/Hip-Hop', artist: a('rnb1', 'R&B/Hip-Hop') },
      { slot: 'Rock & Alternative', artist: a('rock1', 'Rock & Alternative') },
    ];
    const result = assignRoster(keep, [a('pop9', 'Pop')], ALL_SLOTS);
    expect(result).not.toBeNull();
    expect(result!.get('Pop')).toBe('pop9');
    // Kept artists stay put
    expect(result!.get('R&B/Hip-Hop')).toBe('rnb1');
    expect(result!.get('Rock & Alternative')).toBe('rock1');
  });

  it('reshuffles kept artists through Flex when the direct slot is taken', () => {
    // Pop slot is empty; Flex parks a Pop artist; Country slot occupied.
    // Incoming Country artist must chain: countryB -> Flex? no — popA -> Pop,
    // countryB -> Flex, incoming -> Country.
    const keep = [
      { slot: 'Country', artist: a('countryB', 'Country') },
      { slot: 'Flex', artist: a('popA', 'Pop') },
    ];
    const result = assignRoster(keep, [a('countryNew', 'Country')], ALL_SLOTS);
    expect(result).not.toBeNull();
    const slotOf = new Map([...result!].map(([slot, id]) => [id, slot]));
    expect(['Country', 'Flex']).toContain(slotOf.get('countryNew'));
    expect(['Country', 'Flex']).toContain(slotOf.get('countryB'));
    // popA may relocate to Pop if the chain needed its Flex slot
    expect(['Flex', 'Pop']).toContain(slotOf.get('popA'));
    expect(new Set(slotOf.values()).size).toBe(3); // no slot double-booked
  });

  it('returns null when no legal placement exists', () => {
    // Only Pop is open, and nobody in the chain (all R&B or slot-locked) can
    // ever occupy it, so the incoming Country artist cannot be placed.
    const keep = [
      { slot: 'R&B/Hip-Hop', artist: a('r1', 'R&B/Hip-Hop') },
      { slot: 'Rock & Alternative', artist: a('rock1', 'Rock & Alternative') },
      { slot: 'Country', artist: a('c1', 'Country') },
      { slot: 'Other', artist: a('lat1', 'Latin') },
      { slot: 'Flex', artist: a('r2', 'R&B/Hip-Hop') },
      { slot: 'Bench-1', artist: a('r3', 'R&B/Hip-Hop') },
      { slot: 'Bench-2', artist: a('r4', 'R&B/Hip-Hop') },
      { slot: 'Bench-3', artist: a('r5', 'R&B/Hip-Hop') },
    ];
    expect(assignRoster(keep, [a('c2', 'Country')], ALL_SLOTS)).toBeNull();
  });

  it('net-loss rosters keep everyone in place and leave slots empty', () => {
    const keep = [
      { slot: 'Pop', artist: a('p1', 'Pop') },
      { slot: 'Bench-1', artist: a('p2', 'Pop') },
    ];
    const result = assignRoster(keep, [], ALL_SLOTS);
    expect(result).not.toBeNull();
    expect(result!.size).toBe(2);
    expect(result!.get('Pop')).toBe('p1');
    expect(result!.get('Bench-1')).toBe('p2');
  });
});

describe('sidesFromItems', () => {
  it('splits items into per-team outgoing/incoming with drops counted as outgoing only', () => {
    const items = [
      { artistId: 'x', fromTeamId: 'A', toTeamId: 'B', artist: { id: 'x', primaryGenre: 'Pop' } },
      { artistId: 'y', fromTeamId: 'B', toTeamId: 'A', artist: { id: 'y', primaryGenre: 'Country' } },
      { artistId: 'z', fromTeamId: 'B', toTeamId: null, artist: { id: 'z', primaryGenre: 'Pop' } },
    ];
    const [sideA, sideB] = sidesFromItems('A', 'B', items);
    expect(sideA.outgoing).toEqual(['x']);
    expect(sideA.incoming.map((i) => i.id)).toEqual(['y']);
    expect(sideB.outgoing).toEqual(['y', 'z']);
    expect(sideB.incoming.map((i) => i.id)).toEqual(['x']);
  });
});

describe('executeAcceptedTrades', () => {
  const pm = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pm.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  });

  const TRADE = {
    id: 't1',
    proposerTeamId: 'A',
    receiverTeamId: 'B',
    proposerTeam: { id: 'A', name: 'Alpha' },
    receiverTeam: { id: 'B', name: 'Beta' },
    items: [
      { artistId: 'x', fromTeamId: 'A', toTeamId: 'B', artist: { id: 'x', name: 'X', primaryGenre: 'Pop' } },
      { artistId: 'y', fromTeamId: 'B', toTeamId: 'A', artist: { id: 'y', name: 'Y', primaryGenre: 'Pop' } },
    ],
  };

  const rosterA = [
    { id: 'sA1', slot: 'Pop', artistId: 'x', artist: { id: 'x', primaryGenre: 'Pop' } },
    { id: 'sA2', slot: 'Flex', artistId: null, artist: null },
  ];
  const rosterB = [
    { id: 'sB1', slot: 'Pop', artistId: 'y', artist: { id: 'y', primaryGenre: 'Pop' } },
    { id: 'sB2', slot: 'Flex', artistId: null, artist: null },
  ];

  it('swaps the rosters and notifies both teams', async () => {
    pm.trade.findMany.mockResolvedValue([TRADE]);
    pm.trade.updateMany.mockResolvedValue({ count: 1 });
    pm.rosterSpot.findMany.mockImplementation(async (args: any) =>
      args.where.teamId === 'A' ? rosterA : rosterB,
    );
    pm.team.findMany.mockResolvedValue([{ userId: 'uA' }, { userId: 'uB' }]);

    await executeAcceptedTrades('l1');

    // A's Pop spot: x cleared then y written; B's Pop spot: y cleared then x written
    expect(pm.rosterSpot.update).toHaveBeenCalledWith({ where: { id: 'sA1' }, data: { artistId: null } });
    expect(pm.rosterSpot.update).toHaveBeenCalledWith({ where: { id: 'sA1' }, data: { artistId: 'y' } });
    expect(pm.rosterSpot.update).toHaveBeenCalledWith({ where: { id: 'sB1' }, data: { artistId: null } });
    expect(pm.rosterSpot.update).toHaveBeenCalledWith({ where: { id: 'sB1' }, data: { artistId: 'x' } });
    expect(pm.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ type: 'trade_executed' })]) }),
    );
  });

  it('is a no-op when another run already claimed the trade', async () => {
    pm.trade.findMany.mockResolvedValue([TRADE]);
    pm.trade.updateMany.mockResolvedValue({ count: 0 });

    await executeAcceptedTrades('l1');

    expect(pm.rosterSpot.update).not.toHaveBeenCalled();
  });

  it('marks the trade failed when a player left the expected roster', async () => {
    pm.trade.findMany.mockResolvedValue([TRADE]);
    pm.trade.updateMany.mockResolvedValue({ count: 1 });
    // Artist x is gone from A's roster
    pm.rosterSpot.findMany.mockImplementation(async (args: any) =>
      args.where.teamId === 'A' ? [{ id: 'sA1', slot: 'Pop', artistId: null, artist: null }] : rosterB,
    );
    pm.team.findMany.mockResolvedValue([{ userId: 'uA' }, { userId: 'uB' }]);

    await executeAcceptedTrades('l1');

    expect(pm.rosterSpot.update).not.toHaveBeenCalled();
    expect(pm.trade.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
    expect(pm.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ type: 'trade_failed' })]) }),
    );
  });
});

describe('cancelPendingTradesAtDeadline', () => {
  const pm = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

  beforeEach(() => vi.clearAllMocks());

  it('cancels pending trades and notifies both parties', async () => {
    pm.trade.findMany.mockResolvedValue([{ id: 't1', proposerTeamId: 'A', receiverTeamId: 'B' }]);
    pm.trade.updateMany.mockResolvedValue({ count: 1 });
    pm.team.findMany.mockResolvedValue([{ userId: 'uA' }, { userId: 'uB' }]);

    await cancelPendingTradesAtDeadline('l1');

    expect(pm.trade.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'pending' }),
        data: expect.objectContaining({ status: 'cancelled' }),
      }),
    );
    expect(pm.notification.createMany).toHaveBeenCalled();
  });

  it('does nothing when no pending trades exist', async () => {
    pm.trade.findMany.mockResolvedValue([]);
    await cancelPendingTradesAtDeadline('l1');
    expect(pm.trade.updateMany).not.toHaveBeenCalled();
  });
});
