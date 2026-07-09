import { describe, it, expect, vi, beforeEach } from 'vitest';

// Keep the real pipelines (and their prisma/network imports) out entirely.
vi.mock('../../jobs/dailyPipeline', () => ({ runDailyPipeline: vi.fn() }));
vi.mock('../../jobs/finalizePipeline', () => ({ runFinalizePipeline: vi.fn() }));

import { getPTParts, createPipelineScheduler, startPipelineScheduler } from '../../jobs/scheduler';
import { runDailyPipeline } from '../../jobs/dailyPipeline';
import { runFinalizePipeline } from '../../jobs/finalizePipeline';

// A controllable clock: tests mutate `clock` between ticks.
function makeScheduler(startAt: string, overrides: Parameters<typeof createPipelineScheduler>[0] = {}) {
  const state = { clock: new Date(startAt) };
  const runDaily = vi.fn().mockResolvedValue(undefined);
  const runFinalize = vi.fn().mockResolvedValue(undefined);
  const scheduler = createPipelineScheduler({
    now: () => state.clock,
    runDaily,
    runFinalize,
    dailyTargetMinutes: 6 * 60, // 06:00 PT
    ...overrides,
  });
  return { state, runDaily, runFinalize, scheduler };
}

// Deferred promise helper for in-flight/ordering tests.
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('getPTParts', () => {
  it('converts a PDT (summer) instant', () => {
    // 2026-07-06 07:01 UTC = Monday 00:01 PDT
    const pt = getPTParts(new Date('2026-07-06T07:01:00Z'));
    expect(pt).toEqual({ dateStr: '2026-07-06', weekday: 'Monday', minutesOfDay: 1 });
  });

  it('converts a PST (winter) instant', () => {
    // 2026-01-13 07:59 UTC = Monday 23:59 PST on Jan 12
    const pt = getPTParts(new Date('2026-01-13T07:59:00Z'));
    expect(pt).toEqual({ dateStr: '2026-01-12', weekday: 'Monday', minutesOfDay: 23 * 60 + 59 });
  });
});

describe('daily pipeline scheduling', () => {
  it('does not run before the target time', async () => {
    // Wednesday 05:59 PDT
    const { runDaily, scheduler } = makeScheduler('2026-07-08T12:59:00Z');
    await scheduler.tick();
    expect(runDaily).not.toHaveBeenCalled();
  });

  it('runs once past the target and dedupes for the rest of the PT day', async () => {
    // Wednesday 06:00 PDT
    const { state, runDaily, scheduler } = makeScheduler('2026-07-08T13:00:00Z');
    await scheduler.tick();
    expect(runDaily).toHaveBeenCalledTimes(1);

    state.clock = new Date('2026-07-08T18:00:00Z'); // same PT day, 11:00
    await scheduler.tick();
    expect(runDaily).toHaveBeenCalledTimes(1);

    state.clock = new Date('2026-07-09T13:00:00Z'); // Thursday 06:00 PDT
    await scheduler.tick();
    expect(runDaily).toHaveBeenCalledTimes(2);
  });

  it('fires immediately on a boot after the target time (catch-up)', async () => {
    // Wednesday 14:23 PDT — fresh scheduler, target long past
    const { runDaily, scheduler } = makeScheduler('2026-07-08T21:23:00Z');
    await scheduler.tick();
    expect(runDaily).toHaveBeenCalledTimes(1);
  });
});

describe('finalize pipeline scheduling', () => {
  it('does not run on Sunday 23:59 PT', async () => {
    const { runFinalize, scheduler } = makeScheduler('2026-07-06T06:59:00Z'); // Sunday 23:59 PDT
    await scheduler.tick();
    expect(runFinalize).not.toHaveBeenCalled();
  });

  it('runs Monday at 00:01 PT, once per Monday', async () => {
    const { state, runFinalize, scheduler } = makeScheduler('2026-07-06T07:01:00Z'); // Monday 00:01 PDT
    await scheduler.tick();
    expect(runFinalize).toHaveBeenCalledTimes(1);

    state.clock = new Date('2026-07-06T15:00:00Z'); // Monday 08:00 PDT
    await scheduler.tick();
    expect(runFinalize).toHaveBeenCalledTimes(1);
  });

  it('does not catch up on Tuesday', async () => {
    const { runFinalize, scheduler } = makeScheduler('2026-07-07T15:00:00Z'); // Tuesday 08:00 PDT
    await scheduler.tick();
    expect(runFinalize).not.toHaveBeenCalled();
  });

  it('catches up on a boot at Monday noon', async () => {
    const { runFinalize, scheduler } = makeScheduler('2026-07-06T19:00:00Z'); // Monday 12:00 PDT
    await scheduler.tick();
    expect(runFinalize).toHaveBeenCalledTimes(1);
  });
});

describe('Monday ordering', () => {
  it('runs finalize before daily and defers daily until finalize succeeds', async () => {
    // Monday 06:30 PDT — both jobs due
    const { runDaily, runFinalize, scheduler } = makeScheduler('2026-07-06T13:30:00Z');
    const gate = deferred();
    runFinalize.mockReturnValueOnce(gate.promise);

    const tickPromise = scheduler.tick();
    expect(runFinalize).toHaveBeenCalledTimes(1);
    expect(runDaily).not.toHaveBeenCalled();

    gate.resolve();
    await tickPromise;
    // Finalize succeeded within the same tick, so daily runs on this tick too
    // (tick awaits finalize before evaluating daily).
    expect(runDaily).toHaveBeenCalledTimes(1);
  });

  it('keeps daily blocked while finalize is failing on Monday', async () => {
    const { state, runDaily, runFinalize, scheduler } = makeScheduler('2026-07-06T13:30:00Z');
    runFinalize.mockRejectedValueOnce(new Error('apple rss down'));
    await scheduler.tick();
    expect(runDaily).not.toHaveBeenCalled();

    // Next tick 20 min later: finalize retries and succeeds, then daily runs.
    state.clock = new Date('2026-07-06T13:50:00Z');
    await scheduler.tick();
    expect(runFinalize).toHaveBeenCalledTimes(2);
    expect(runDaily).toHaveBeenCalledTimes(1);
  });
});

describe('overlap guard and retries', () => {
  it('does not start a second run while one is in flight', async () => {
    const { runDaily, scheduler } = makeScheduler('2026-07-08T13:00:00Z'); // Wednesday 06:00 PDT
    const gate = deferred();
    runDaily.mockReturnValueOnce(gate.promise);

    const first = scheduler.tick();
    await scheduler.tick(); // second tick while first run is pending
    expect(runDaily).toHaveBeenCalledTimes(1);

    gate.resolve();
    await first;
  });

  it('a failed run resolves the tick and retries after the backoff', async () => {
    const { state, runDaily, scheduler } = makeScheduler('2026-07-08T13:00:00Z');
    runDaily.mockRejectedValueOnce(new Error('boom'));
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(runDaily).toHaveBeenCalledTimes(1);

    state.clock = new Date('2026-07-08T13:05:00Z'); // 5 min later — inside backoff
    await scheduler.tick();
    expect(runDaily).toHaveBeenCalledTimes(1);

    state.clock = new Date('2026-07-08T13:16:00Z'); // 16 min later — past backoff
    await scheduler.tick();
    expect(runDaily).toHaveBeenCalledTimes(2);
  });
});

describe('startPipelineScheduler', () => {
  beforeEach(() => {
    vi.mocked(runDailyPipeline).mockClear();
    vi.mocked(runFinalizePipeline).mockClear();
  });

  it('is a no-op under NODE_ENV=test', async () => {
    vi.useFakeTimers();
    try {
      expect(process.env.NODE_ENV).toBe('test');
      startPipelineScheduler(); // must not create a timer
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(runDailyPipeline).not.toHaveBeenCalled();
      expect(runFinalizePipeline).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('start() ticks on the configured interval', async () => {
    vi.useFakeTimers();
    try {
      const runDaily = vi.fn().mockResolvedValue(undefined);
      const runFinalize = vi.fn().mockResolvedValue(undefined);
      // Wednesday 06:00 PDT, 1s interval
      const clock = new Date('2026-07-08T13:00:00Z');
      const scheduler = createPipelineScheduler({
        now: () => clock,
        runDaily,
        runFinalize,
        dailyTargetMinutes: 6 * 60,
        intervalMs: 1000,
      });
      const timer = scheduler.start();
      await vi.advanceTimersByTimeAsync(3000);
      expect(runDaily).toHaveBeenCalledTimes(1); // fired once, then deduped
      clearInterval(timer);
    } finally {
      vi.useRealTimers();
    }
  });
});
