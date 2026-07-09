import { runDailyPipeline } from './dailyPipeline';
import { runFinalizePipeline } from './finalizePipeline';

// In-process scheduler for the two batch pipelines. The app runs as a single
// always-on Railway service, so a 60s ticker (same pattern as
// startDraftScheduler) replaces external cron. Date-based dedupe means a
// restart mid-window still fires the job on the first tick after boot —
// both pipelines are idempotent, so a redundant run is harmless.

const PT_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface PTParts {
  dateStr: string; // YYYY-MM-DD in PT
  weekday: string; // 'Monday', ...
  minutesOfDay: number; // 0-1439 in PT
}

export function getPTParts(now: Date): PTParts {
  const parts: Record<string, string> = {};
  for (const { type, value } of PT_FORMAT.formatToParts(now)) {
    parts[type] = value;
  }
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    minutesOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const DEFAULT_DAILY_TIME_PT = '06:00';
const FINALIZE_MINUTES = 1; // Monday 00:01 PT
const RETRY_DELAY_MS = 15 * 60_000;

function parseDailyTarget(raw: string | undefined): number {
  const fallback = DEFAULT_DAILY_TIME_PT;
  const value = raw ?? fallback;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  const hours = match ? Number(match[1]) : NaN;
  const minutes = match ? Number(match[2]) : NaN;
  if (!match || hours > 23 || minutes > 59) {
    if (raw) console.warn(`[scheduler] invalid DAILY_PIPELINE_TIME_PT "${raw}", using ${fallback}`);
    return parseDailyTarget(fallback);
  }
  return hours * 60 + minutes;
}

export interface SchedulerDeps {
  now?: () => Date;
  runDaily?: () => Promise<void>;
  runFinalize?: () => Promise<void>;
  dailyTargetMinutes?: number;
  intervalMs?: number;
}

interface JobState {
  lastSuccessDatePT: string | null;
  inFlight: boolean;
  nextAttemptAtMs: number;
}

export function createPipelineScheduler(deps: SchedulerDeps = {}) {
  const now = deps.now ?? (() => new Date());
  const runDaily = deps.runDaily ?? runDailyPipeline;
  const runFinalize = deps.runFinalize ?? runFinalizePipeline;
  const dailyTargetMinutes = deps.dailyTargetMinutes ?? parseDailyTarget(process.env.DAILY_PIPELINE_TIME_PT);
  const intervalMs = deps.intervalMs ?? 60_000;

  const daily: JobState = { lastSuccessDatePT: null, inFlight: false, nextAttemptAtMs: 0 };
  const finalize: JobState = { lastSuccessDatePT: null, inFlight: false, nextAttemptAtMs: 0 };

  async function runJob(name: string, state: JobState, run: () => Promise<void>, dateStr: string) {
    state.inFlight = true;
    console.log(`[scheduler] starting ${name} pipeline for PT date ${dateStr}`);
    try {
      await run();
      state.lastSuccessDatePT = dateStr;
      console.log(`[scheduler] ${name} pipeline succeeded`);
    } catch (err) {
      state.nextAttemptAtMs = now().getTime() + RETRY_DELAY_MS;
      console.error(`[scheduler] ${name} pipeline failed, retrying in ${RETRY_DELAY_MS / 60_000} min:`, err);
    } finally {
      state.inFlight = false;
    }
  }

  function isDue(state: JobState, dateStr: string, pastTarget: boolean): boolean {
    return (
      pastTarget &&
      state.lastSuccessDatePT !== dateStr &&
      !state.inFlight &&
      now().getTime() >= state.nextAttemptAtMs
    );
  }

  async function tick(): Promise<void> {
    try {
      const pt = getPTParts(now());

      // Finalize: Monday >= 00:01 PT only. No catch-up on later days — by then
      // the daily pipeline has scored the new week; a missed Monday is a
      // manual-run situation.
      const finalizeDue = pt.weekday === 'Monday' && isDue(finalize, pt.dateStr, pt.minutesOfDay >= FINALIZE_MINUTES);
      if (finalizeDue) {
        await runJob('finalize', finalize, runFinalize, pt.dateStr);
      }

      // Daily: once per PT date after the target time. On Mondays, wait until
      // finalize has succeeded (it advances currentWeek before scoring).
      const blockedByFinalize =
        finalize.inFlight || (pt.weekday === 'Monday' && finalize.lastSuccessDatePT !== pt.dateStr);
      if (!blockedByFinalize && isDue(daily, pt.dateStr, pt.minutesOfDay >= dailyTargetMinutes)) {
        await runJob('daily', daily, runDaily, pt.dateStr);
      }
    } catch (err) {
      console.error('[scheduler] tick failed:', err);
    }
  }

  function start(): NodeJS.Timeout {
    console.log(
      `[scheduler] pipeline scheduler started — daily at ${Math.floor(dailyTargetMinutes / 60)
        .toString()
        .padStart(2, '0')}:${(dailyTargetMinutes % 60).toString().padStart(2, '0')} PT, ` +
        `finalize Monday 00:0${FINALIZE_MINUTES} PT, tick every ${intervalMs / 1000}s`,
    );
    return setInterval(() => { void tick(); }, intervalMs);
  }

  return { tick, start };
}

export function startPipelineScheduler(): void {
  if (process.env.NODE_ENV === 'test' || process.env.PIPELINE_SCHEDULER_DISABLED) {
    console.log('[scheduler] pipeline scheduler disabled');
    return;
  }
  createPipelineScheduler().start();
}
