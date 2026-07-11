import { prisma } from '../db/prisma';
import { sendEmail } from './mailer';
import { subjectFor, renderEmail } from './templates';

// Email outbox dispatcher. Notification rows are the outbox: every personal
// notification is written first (often inside a transaction), and this loop
// later emails the ones with emailedAt = null. Decoupling sends from the
// write path keeps network calls out of DB transactions and makes the
// finalize pipeline's re-runs email-safe for free — emailedAt is the single
// send gate. Same ticker pattern as jobs/scheduler.ts.

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60_000;
// Resend free tier allows 2 req/s; 600ms between sends keeps us under it.
const SEND_GAP_MS = 600;

export interface DispatcherDeps {
  now?: () => Date;
  send?: typeof sendEmail;
  sleep?: (ms: number) => Promise<void>;
  batchSize?: number;
  intervalMs?: number;
  maxAgeMs?: number;
}

export function createEmailDispatcher(deps: DispatcherDeps = {}) {
  const now = deps.now ?? (() => new Date());
  const send = deps.send ?? sendEmail;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxAgeMs = deps.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

  let inFlight = false;

  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      // Retire anything that has sat unsent past the age cap (extended outage,
      // key configured late, poison rows) — better no email than a stale flood.
      const stale = await prisma.notification.updateMany({
        where: { emailedAt: null, createdAt: { lt: new Date(now().getTime() - maxAgeMs) } },
        data: { emailedAt: now() },
      });
      if (stale.count > 0) {
        console.log(`[email] retired ${stale.count} stale notification(s) without sending`);
      }

      const pending = await prisma.notification.findMany({
        where: { emailedAt: null },
        include: { user: { select: { email: true, username: true } } },
        orderBy: { createdAt: 'asc' },
        take: batchSize,
      });

      for (let i = 0; i < pending.length; i++) {
        const row = pending[i];
        const { html, text } = renderEmail({ username: row.user.username, message: row.message });
        const result = await send({ to: row.user.email, subject: subjectFor(row.type), html, text });

        if (result.status === 'sent' || (result.status === 'failed' && result.permanent)) {
          await prisma.notification.update({ where: { id: row.id }, data: { emailedAt: now() } });
          if (result.status === 'sent') {
            console.log(`[email] sent ${row.type} to ${row.user.email}`);
          } else {
            console.error(`[email] permanent failure for ${row.type} to ${row.user.email}, retiring: ${result.detail}`);
          }
        } else if (result.status === 'failed') {
          // Transient — leave emailedAt null for the next tick, keep going so
          // one flaky recipient can't block the queue.
          console.warn(`[email] transient failure for ${row.type} to ${row.user.email}, will retry: ${result.detail}`);
        }

        if (i < pending.length - 1) await sleep(SEND_GAP_MS);
      }
    } catch (err) {
      console.error('[email] tick failed:', err);
    } finally {
      inFlight = false;
    }
  }

  function start(): NodeJS.Timeout {
    console.log(`[email] dispatcher started — ${batchSize}/batch, tick every ${intervalMs / 1000}s`);
    return setInterval(() => { void tick(); }, intervalMs);
  }

  return { tick, start };
}

export function startEmailDispatcher(): void {
  if (process.env.NODE_ENV === 'test' || process.env.EMAIL_DISPATCH_DISABLED) {
    console.log('[email] dispatcher disabled');
    return;
  }
  if (!process.env.RESEND_API_KEY) {
    // Unsent rows accumulate until a key exists; the stale sweep retires
    // anything older than the age cap on the first real tick.
    console.log('[email] RESEND_API_KEY not set — dispatcher not started');
    return;
  }
  createEmailDispatcher().start();
}
