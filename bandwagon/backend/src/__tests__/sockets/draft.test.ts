import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../db/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(), update: vi.fn() },
    draftState: { findUnique: vi.fn(), update: vi.fn() },
    team: { findUnique: vi.fn() },
    artist: { findUnique: vi.fn() },
    draftPick: { findMany: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([{}, {}]),
  },
}));

vi.mock('../../api/routes/draft', () => ({
  makePick: vi.fn(),
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
  },
}));

import { prisma } from '../../db/prisma';
import { makePick } from '../../api/routes/draft';
import jwt from 'jsonwebtoken';
import { registerDraftSocket } from '../../sockets/draft';

const pm = prisma as unknown as {
  league: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  draftState: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  team: { findUnique: ReturnType<typeof vi.fn> };
  artist: { findUnique: ReturnType<typeof vi.fn> };
  draftPick: { findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const mockMakePick = vi.mocked(makePick);
const mockJwtVerify = vi.mocked(jwt.verify);

// ---------------------------------------------------------------------------
// Socket + IO factory helpers
// ---------------------------------------------------------------------------

type Handler = (data: any) => Promise<void> | void;

function createMockSocket() {
  const handlers: Record<string, Handler> = {};
  const socket = {
    on: vi.fn((event: string, handler: Handler) => { handlers[event] = handler; }),
    emit: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
  };
  return { socket, handlers };
}

let connectionHandler: ((socket: any) => void) | undefined;
const roomEmit = vi.fn();

const mockIo = {
  on: vi.fn((event: string, handler: any) => {
    if (event === 'connection') connectionHandler = handler;
  }),
  to: vi.fn(() => ({ emit: roomEmit })),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  connectionHandler = undefined;
  pm.$transaction.mockResolvedValue([{}, {}]);
  registerDraftSocket(mockIo as any);
});

afterEach(() => {
  vi.useRealTimers();
});

function connect() {
  const { socket, handlers } = createMockSocket();
  connectionHandler!(socket);
  return { socket, handlers };
}

// ---------------------------------------------------------------------------
// draft:join — authentication
// ---------------------------------------------------------------------------

describe('draft:join — authentication', () => {
  it('emits draft:error when JWT verification fails', async () => {
    mockJwtVerify.mockImplementation(() => { throw new Error('invalid token'); });
    const { socket, handlers } = connect();

    await handlers['draft:join']({ leagueId: 'l1', token: 'bad-token' });

    expect(socket.emit).toHaveBeenCalledWith('draft:error', 'Authentication failed');
    expect(pm.league.findUnique).not.toHaveBeenCalled();
  });

  it('emits draft:error when league not found after successful auth', async () => {
    mockJwtVerify.mockReturnValue({ userId: 'user-1' } as any);
    pm.league.findUnique.mockResolvedValue(null);
    const { socket, handlers } = connect();

    await handlers['draft:join']({ leagueId: 'bad-league', token: 'valid' });

    expect(socket.emit).toHaveBeenCalledWith('draft:error', 'League not found');
  });
});

// ---------------------------------------------------------------------------
// draft:join — state broadcast
// ---------------------------------------------------------------------------

describe('draft:join — state broadcast', () => {
  const DRAFT_TIME = new Date(Date.now() + 5 * 60_000);

  it('broadcasts pre_draft state with countdownEndsAt from league.draftTime', async () => {
    mockJwtVerify.mockReturnValue({ userId: 'user-1' } as any);
    pm.league.findUnique.mockResolvedValue({
      id: 'l1',
      status: 'pre_draft',
      draftTime: DRAFT_TIME,
      draftState: { currentPick: 0, pickOrder: ['t1', 't2'], isComplete: false },
      teams: [],
      draftPicks: [],
    });
    const { socket, handlers } = connect();

    await handlers['draft:join']({ leagueId: 'l1', token: 'valid' });

    expect(socket.emit).toHaveBeenCalledWith('draft:state',
      expect.objectContaining({
        status: 'pre_draft',
        countdownEndsAt: DRAFT_TIME,
      })
    );
  });

  it('broadcasts drafting state with current pick index and pick order', async () => {
    mockJwtVerify.mockReturnValue({ userId: 'user-1' } as any);
    pm.league.findUnique.mockResolvedValue({
      id: 'l1',
      status: 'drafting',
      draftTime: null,
      draftState: { currentPick: 3, pickOrder: ['t1','t2','t2','t1'], isComplete: false, timerEndsAt: null },
      teams: [],
      draftPicks: [],
    });
    const { socket, handlers } = connect();

    await handlers['draft:join']({ leagueId: 'l1', token: 'valid' });

    expect(socket.emit).toHaveBeenCalledWith('draft:state',
      expect.objectContaining({
        status: 'drafting',
        currentPickIndex: 3,
        countdownEndsAt: null,
      })
    );
  });
});

// ---------------------------------------------------------------------------
// draft:skip-countdown
// ---------------------------------------------------------------------------

describe('draft:skip-countdown', () => {
  it('emits draft:error when non-commissioner tries to skip', async () => {
    mockJwtVerify.mockReturnValue({ userId: 'user-2' } as any); // not commissioner
    pm.league.findUnique.mockResolvedValue({
      id: 'l1',
      commissionerId: 'user-1',
      status: 'pre_draft',
    });
    const { socket, handlers } = connect();

    await handlers['draft:skip-countdown']({ leagueId: 'l1', token: 'valid' });

    expect(socket.emit).toHaveBeenCalledWith('draft:error',
      'Only the commissioner can skip the countdown'
    );
  });

  it('emits draft:error when league not found', async () => {
    mockJwtVerify.mockReturnValue({ userId: 'user-1' } as any);
    pm.league.findUnique.mockResolvedValue(null);
    const { socket, handlers } = connect();

    await handlers['draft:skip-countdown']({ leagueId: 'bad', token: 'valid' });

    expect(socket.emit).toHaveBeenCalledWith('draft:error', 'League not found');
  });

  it('transitions to live draft when commissioner skips (status pre_draft)', async () => {
    mockJwtVerify.mockReturnValue({ userId: 'user-1' } as any);
    pm.league.findUnique
      .mockResolvedValueOnce({ id: 'l1', commissionerId: 'user-1', status: 'pre_draft' })
      .mockResolvedValueOnce({ // state after transition
        id: 'l1', status: 'drafting',
        draftState: { currentPick: 0, pickOrder: ['t1'], timerEndsAt: new Date() },
        teams: [], draftPicks: [],
      });
    pm.league.update.mockResolvedValue({});
    pm.draftState.update.mockResolvedValue({});
    const { handlers } = connect();

    await handlers['draft:skip-countdown']({ leagueId: 'l1', token: 'valid' });

    // Should have updated league to drafting status
    expect(pm.league.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'drafting' } })
    );
    // Should broadcast new state to the room
    expect(roomEmit).toHaveBeenCalledWith('draft:state',
      expect.objectContaining({ status: 'drafting' })
    );
  });
});

// ---------------------------------------------------------------------------
// draft:pick
// ---------------------------------------------------------------------------

describe('draft:pick', () => {
  const DRAFT_STATE = {
    isComplete: false,
    currentPick: 0,
    pickOrder: ['team-1'],
  };

  const TEAM_WITH_EMPTY_ROSTER = {
    id: 'team-1',
    userId: 'user-1',
    rosterSpots: [], // all slots open
  };

  const ARTIST_POP = { id: 'artist-1', name: 'Pop Star', primaryGenre: 'Pop' };

  it('emits draft:error when artist is not found', async () => {
    mockJwtVerify.mockReturnValue({ userId: 'user-1' } as any);
    pm.draftState.findUnique.mockResolvedValue(DRAFT_STATE);
    pm.team.findUnique.mockResolvedValue(TEAM_WITH_EMPTY_ROSTER);
    pm.artist.findUnique.mockResolvedValue(null);
    const { socket, handlers } = connect();

    await handlers['draft:pick']({ leagueId: 'l1', artistId: 'bad-artist', token: 'valid' });

    expect(socket.emit).toHaveBeenCalledWith('draft:error', 'Artist not found');
  });

  it('emits draft:pick-made on successful pick', async () => {
    mockJwtVerify.mockReturnValue({ userId: 'user-1' } as any);
    pm.draftState.findUnique.mockResolvedValue(DRAFT_STATE);
    pm.team.findUnique.mockResolvedValue(TEAM_WITH_EMPTY_ROSTER);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    mockMakePick.mockResolvedValue({
      pick: { id: 'pick-1', artistId: 'artist-1' },
      isComplete: false,
    });

    const { handlers } = connect();
    await handlers['draft:pick']({ leagueId: 'l1', artistId: 'artist-1', token: 'valid' });

    expect(roomEmit).toHaveBeenCalledWith('draft:pick-made',
      expect.objectContaining({ id: 'pick-1' })
    );
  });

  it('emits draft:error when makePick returns an error', async () => {
    mockJwtVerify.mockReturnValue({ userId: 'user-1' } as any);
    pm.draftState.findUnique.mockResolvedValue(DRAFT_STATE);
    pm.team.findUnique.mockResolvedValue(TEAM_WITH_EMPTY_ROSTER);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    mockMakePick.mockResolvedValue({ error: 'Artist already drafted' });

    const { socket, handlers } = connect();
    await handlers['draft:pick']({ leagueId: 'l1', artistId: 'artist-1', token: 'valid' });

    expect(socket.emit).toHaveBeenCalledWith('draft:error', 'Artist already drafted');
  });

  it('emits draft:complete when last pick is made (isComplete=true)', async () => {
    mockJwtVerify.mockReturnValue({ userId: 'user-1' } as any);
    pm.draftState.findUnique.mockResolvedValue(DRAFT_STATE);
    pm.team.findUnique.mockResolvedValue(TEAM_WITH_EMPTY_ROSTER);
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);
    mockMakePick.mockResolvedValue({
      pick: { id: 'pick-last', artistId: 'artist-1' },
      isComplete: true, // final pick
    });

    const { handlers } = connect();
    await handlers['draft:pick']({ leagueId: 'l1', artistId: 'artist-1', token: 'valid' });

    expect(roomEmit).toHaveBeenCalledWith('draft:pick-made', expect.any(Object));
    expect(roomEmit).toHaveBeenCalledWith('draft:complete');
  });

  it('emits draft:error when no eligible slot exists for the artist', async () => {
    mockJwtVerify.mockReturnValue({ userId: 'user-1' } as any);
    pm.draftState.findUnique.mockResolvedValue(DRAFT_STATE);
    // All 9 slots already filled — no openSlots
    pm.team.findUnique.mockResolvedValue({
      id: 'team-1', userId: 'user-1',
      rosterSpots: [
        { slot: 'R&B/Hip-Hop', artistId: 'a1' }, { slot: 'Pop', artistId: 'a2' },
        { slot: 'Rock & Alternative', artistId: 'a3' }, { slot: 'Country', artistId: 'a4' },
        { slot: 'Other', artistId: 'a5' }, { slot: 'Flex', artistId: 'a6' },
        { slot: 'Bench-1', artistId: 'a7' }, { slot: 'Bench-2', artistId: 'a8' },
        { slot: 'Bench-3', artistId: 'a9' },
      ],
    });
    pm.artist.findUnique.mockResolvedValue(ARTIST_POP);

    const { socket, handlers } = connect();
    await handlers['draft:pick']({ leagueId: 'l1', artistId: 'artist-1', token: 'valid' });

    expect(socket.emit).toHaveBeenCalledWith('draft:error',
      expect.stringContaining('No eligible slot')
    );
  });
});
