import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';

vi.mock('../../db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    league: { findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
    team: { findMany: vi.fn(), delete: vi.fn() },
    waiverClaim: { updateMany: vi.fn() },
    notification: { create: vi.fn(), deleteMany: vi.fn() },
    passwordResetToken: { deleteMany: vi.fn() },
    leagueEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../db/prisma';
import { deleteAccount } from '../../account/deleteAccount';

const pm = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
};

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await bcrypt.hash('correct-pw', 4);
});

const USER = () => ({
  id: 'user-1',
  email: 'maven@example.com',
  username: 'Maven',
  avatarUrl: 'https://ui-avatars.com/api/?name=Maven',
  passwordHash,
  deletedAt: null,
});

function memberTeam(id: string, userId: string, joined: string, deletedAt: Date | null = null) {
  return {
    id,
    userId,
    createdAt: new Date(joined),
    user: { id: userId, username: `user ${userId}`, deletedAt },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  pm.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  pm.league.findMany.mockResolvedValue([]);
  pm.team.findMany.mockResolvedValue([]);
});

describe('deleteAccount', () => {
  it('404 when the user does not exist or was already deleted', async () => {
    pm.user.findUnique.mockResolvedValue(null);
    expect(await deleteAccount('user-1', 'correct-pw')).toMatchObject({ status: 404 });

    pm.user.findUnique.mockResolvedValue({ ...USER(), deletedAt: new Date() });
    expect(await deleteAccount('user-1', 'correct-pw')).toMatchObject({ status: 404 });
    expect(pm.$transaction).not.toHaveBeenCalled();
  });

  it('403 on a wrong password without touching anything', async () => {
    pm.user.findUnique.mockResolvedValue(USER());
    expect(await deleteAccount('user-1', 'wrong-pw')).toMatchObject({ status: 403 });
    expect(pm.$transaction).not.toHaveBeenCalled();
  });

  it('hard-deletes when no team is in a started season', async () => {
    pm.user.findUnique.mockResolvedValue(USER());
    pm.team.findMany.mockResolvedValue([
      { id: 't-1', leagueId: 'l-1', name: 'My Squad', league: { id: 'l-1', name: 'Pending League', status: 'pending' } },
    ]);

    const result = await deleteAccount('user-1', 'correct-pw');

    expect(result).toEqual({ ok: true, mode: 'hard' });
    expect(pm.team.delete).toHaveBeenCalledWith({ where: { id: 't-1' } });
    expect(pm.leagueEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ leagueId: 'l-1', type: 'member_left' }),
    });
    expect(pm.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    expect(pm.user.update).not.toHaveBeenCalled();
  });

  it('hands commissioned leagues to the earliest-joined member with a live account', async () => {
    pm.user.findUnique.mockResolvedValue(USER());
    pm.league.findMany.mockResolvedValue([
      {
        id: 'l-1',
        name: 'My League',
        teams: [
          memberTeam('t-own', 'user-1', '2026-01-01'),
          memberTeam('t-ghost', 'user-2', '2026-01-02', new Date()), // already deleted account
          memberTeam('t-heir', 'user-3', '2026-01-03'),
          memberTeam('t-later', 'user-4', '2026-01-04'),
        ],
      },
    ]);

    const result = await deleteAccount('user-1', 'correct-pw');

    expect(result).toMatchObject({ ok: true });
    expect(pm.league.update).toHaveBeenCalledWith({
      where: { id: 'l-1' },
      data: { commissionerId: 'user-3' },
    });
    expect(pm.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-3', leagueId: 'l-1', type: 'commissioner_transfer' }),
    });
    expect(pm.leagueEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ leagueId: 'l-1', type: 'commissioner_transferred' }),
    });
    expect(pm.league.delete).not.toHaveBeenCalled();
  });

  it('deletes a commissioned league with no one to inherit it', async () => {
    pm.user.findUnique.mockResolvedValue(USER());
    pm.league.findMany.mockResolvedValue([
      { id: 'l-1', name: 'Solo League', teams: [memberTeam('t-own', 'user-1', '2026-01-01')] },
    ]);
    // The own team row also comes back from team.findMany but must be skipped:
    // the league cascade already removed it.
    pm.team.findMany.mockResolvedValue([
      { id: 't-own', leagueId: 'l-1', name: 'My Squad', league: { id: 'l-1', name: 'Solo League', status: 'active' } },
    ]);

    const result = await deleteAccount('user-1', 'correct-pw');

    expect(result).toEqual({ ok: true, mode: 'hard' });
    expect(pm.league.delete).toHaveBeenCalledWith({ where: { id: 'l-1' } });
    expect(pm.league.update).not.toHaveBeenCalled();
    expect(pm.team.delete).not.toHaveBeenCalled();
    expect(pm.user.delete).toHaveBeenCalled();
  });

  it('soft-deletes (anonymizes) when a team sits in a started season', async () => {
    pm.user.findUnique.mockResolvedValue(USER());
    pm.team.findMany.mockResolvedValue([
      { id: 't-1', leagueId: 'l-1', name: 'My Squad', league: { id: 'l-1', name: 'Active League', status: 'active' } },
    ]);

    const result = await deleteAccount('user-1', 'correct-pw');

    expect(result).toEqual({ ok: true, mode: 'soft' });
    expect(pm.team.delete).not.toHaveBeenCalled();
    expect(pm.leagueEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leagueId: 'l-1',
        type: 'member_left',
        message: expect.stringContaining('unmanaged'),
      }),
    });
    expect(pm.waiverClaim.updateMany).toHaveBeenCalledWith({
      where: { teamId: { in: ['t-1'] }, status: 'pending' },
      data: expect.objectContaining({ status: 'cancelled' }),
    });
    expect(pm.notification.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(pm.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(pm.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        email: expect.stringMatching(/^deleted-/),
        username: expect.stringMatching(/^deleted_/),
        passwordHash: '!account-deleted',
        avatarUrl: null,
        deletedAt: expect.any(Date),
      }),
    });
    expect(pm.user.delete).not.toHaveBeenCalled();
  });

  it('handles a mix of commissioned, pending, and active leagues', async () => {
    pm.user.findUnique.mockResolvedValue(USER());
    pm.league.findMany.mockResolvedValue([
      {
        id: 'l-a',
        name: 'League A',
        teams: [memberTeam('t-a', 'user-1', '2026-01-01'), memberTeam('t-a2', 'user-2', '2026-01-02')],
      },
    ]);
    pm.team.findMany.mockResolvedValue([
      { id: 't-a', leagueId: 'l-a', name: 'Squad A', league: { id: 'l-a', name: 'League A', status: 'active' } },
      { id: 't-b', leagueId: 'l-b', name: 'Squad B', league: { id: 'l-b', name: 'League B', status: 'pending' } },
      { id: 't-c', leagueId: 'l-c', name: 'Squad C', league: { id: 'l-c', name: 'League C', status: 'drafting' } },
    ]);

    const result = await deleteAccount('user-1', 'correct-pw');

    expect(result).toEqual({ ok: true, mode: 'soft' });
    // League A handed off, its (active) team kept
    expect(pm.league.update).toHaveBeenCalledWith({ where: { id: 'l-a' }, data: { commissionerId: 'user-2' } });
    // Pending team removed
    expect(pm.team.delete).toHaveBeenCalledTimes(1);
    expect(pm.team.delete).toHaveBeenCalledWith({ where: { id: 't-b' } });
    // Both surviving teams keep playing
    expect(pm.waiverClaim.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: { in: ['t-a', 't-c'] } }) }),
    );
    expect(pm.user.delete).not.toHaveBeenCalled();
    expect(pm.user.update).toHaveBeenCalled();
  });
});
