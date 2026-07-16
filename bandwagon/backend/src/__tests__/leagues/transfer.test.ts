import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transferCommissioner } from '../../leagues/transfer';

const db = {
  league: { update: vi.fn() },
  notification: { create: vi.fn() },
  leagueEvent: { create: vi.fn() },
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('transferCommissioner', () => {
  it('updates the league, notifies the new commissioner, and logs a feed event', async () => {
    await transferCommissioner(db, { id: 'l-1', name: 'My League' }, { id: 'user-2', username: 'Heir' });

    expect(db.league.update).toHaveBeenCalledWith({
      where: { id: 'l-1' },
      data: { commissionerId: 'user-2' },
    });
    expect(db.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-2',
        leagueId: 'l-1',
        type: 'commissioner_transfer',
        message: 'You are now the commissioner of My League.',
      },
    });
    expect(db.leagueEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leagueId: 'l-1',
        type: 'commissioner_transferred',
        message: expect.stringContaining('Heir'),
      }),
    });
  });

  it('falls back to a generic name for members without a username', async () => {
    await transferCommissioner(db, { id: 'l-1', name: 'My League' }, { id: 'user-2', username: null });

    expect(db.leagueEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ message: expect.stringContaining('A member') }),
    });
  });
});
