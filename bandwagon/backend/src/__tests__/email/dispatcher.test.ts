import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma', () => ({
  prisma: {
    notification: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../db/prisma';
import { createEmailDispatcher, startEmailDispatcher } from '../../email/dispatcher';
import type { SendResult } from '../../email/mailer';

const pm = prisma as unknown as {
  notification: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};

const NOW = new Date('2026-07-10T12:00:00Z');

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    type: 'trade_proposed',
    message: 'Team A proposed a trade.',
    createdAt: new Date('2026-07-10T11:00:00Z'),
    user: { email: 'user@example.com', username: 'MusicMaven' },
    ...overrides,
  };
}

function makeDispatcher(send: (i: unknown) => Promise<SendResult>) {
  const sendMock = vi.fn(send);
  const dispatcher = createEmailDispatcher({
    now: () => NOW,
    send: sendMock as never,
    sleep: () => Promise.resolve(),
  });
  return { dispatcher, sendMock };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  pm.notification.findMany.mockReset().mockResolvedValue([]);
  pm.notification.update.mockReset().mockResolvedValue({});
  pm.notification.updateMany.mockReset().mockResolvedValue({ count: 0 });
});

describe('email dispatcher tick', () => {
  it('sends pending notifications and marks them emailed', async () => {
    pm.notification.findMany.mockResolvedValue([
      makeRow(),
      makeRow({ id: 'n2', type: 'waiver_result', user: { email: 'b@example.com', username: null } }),
    ]);
    const { dispatcher, sendMock } = makeDispatcher(async () => ({ status: 'sent' }));

    await dispatcher.tick();

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      to: 'user@example.com',
      subject: 'You have a new trade offer',
    });
    expect(sendMock.mock.calls[1][0]).toMatchObject({
      to: 'b@example.com',
      subject: 'Your waiver claim results are in',
    });
    expect(pm.notification.update).toHaveBeenCalledTimes(2);
    expect(pm.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { emailedAt: NOW },
    });
  });

  it('queries oldest-first with the batch size and user email joined', async () => {
    const { dispatcher } = makeDispatcher(async () => ({ status: 'sent' }));
    await dispatcher.tick();
    expect(pm.notification.findMany).toHaveBeenCalledWith({
      where: { emailedAt: null },
      include: { user: { select: { email: true, username: true } } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
  });

  it('uses the fallback subject for unknown types', async () => {
    pm.notification.findMany.mockResolvedValue([makeRow({ type: 'mystery_type' })]);
    const { dispatcher, sendMock } = makeDispatcher(async () => ({ status: 'sent' }));
    await dispatcher.tick();
    expect(sendMock.mock.calls[0][0]).toMatchObject({ subject: 'Bandwagoner update' });
  });

  it('leaves transient failures unmarked but continues to later rows', async () => {
    pm.notification.findMany.mockResolvedValue([makeRow(), makeRow({ id: 'n2' })]);
    const results: SendResult[] = [
      { status: 'failed', permanent: false, detail: '500' },
      { status: 'sent' },
    ];
    const { dispatcher, sendMock } = makeDispatcher(async () => results.shift()!);

    await dispatcher.tick();

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(pm.notification.update).toHaveBeenCalledTimes(1);
    expect(pm.notification.update).toHaveBeenCalledWith({
      where: { id: 'n2' },
      data: { emailedAt: NOW },
    });
  });

  it('retires permanent failures without treating them as sent', async () => {
    pm.notification.findMany.mockResolvedValue([makeRow()]);
    const { dispatcher } = makeDispatcher(async () => ({
      status: 'failed',
      permanent: true,
      detail: '403 domain not verified',
    }));

    await dispatcher.tick();

    expect(pm.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { emailedAt: NOW },
    });
  });

  it('sweeps stale rows past the age cap before sending', async () => {
    const { dispatcher } = makeDispatcher(async () => ({ status: 'sent' }));
    await dispatcher.tick();
    expect(pm.notification.updateMany).toHaveBeenCalledWith({
      where: {
        emailedAt: null,
        createdAt: { lt: new Date(NOW.getTime() - 24 * 60 * 60_000) },
      },
      data: { emailedAt: NOW },
    });
    const sweepOrder = pm.notification.updateMany.mock.invocationCallOrder[0];
    const queryOrder = pm.notification.findMany.mock.invocationCallOrder[0];
    expect(sweepOrder).toBeLessThan(queryOrder);
  });

  it('does not overlap ticks while one is in flight', async () => {
    pm.notification.findMany.mockResolvedValue([makeRow()]);
    const gate = deferred<SendResult>();
    const { dispatcher, sendMock } = makeDispatcher(() => gate.promise);

    const first = dispatcher.tick();
    await dispatcher.tick(); // re-entrant tick while send is pending
    expect(pm.notification.findMany).toHaveBeenCalledTimes(1);

    gate.resolve({ status: 'sent' });
    await first;
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('resolves without throwing when the query fails', async () => {
    pm.notification.findMany.mockRejectedValue(new Error('db down'));
    const { dispatcher } = makeDispatcher(async () => ({ status: 'sent' }));
    await expect(dispatcher.tick()).resolves.toBeUndefined();
  });
});

describe('startEmailDispatcher', () => {
  it('is a no-op under NODE_ENV=test', () => {
    vi.useFakeTimers();
    try {
      expect(process.env.NODE_ENV).toBe('test');
      startEmailDispatcher(); // must not create a timer
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
