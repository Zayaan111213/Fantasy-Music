import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { sendEmail } from '../../email/mailer';

const router = Router();

// Keep in sync with CONTACT_EMAIL in frontend/src/lib/legal.ts, which is the
// address published on the legal pages. The backend cannot import from the
// web app, so this fallback is a deliberate copy. SUPPORT_EMAIL overrides it
// if reports should go somewhere other than the public address.
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'bandwagonersupport@gmail.com';

const ReportSchema = z.object({
  targetType: z.enum(['user', 'team', 'league']),
  targetId: z.string().min(1),
  reason: z.enum(['offensive_name', 'offensive_image', 'harassment', 'spam', 'other']),
  details: z.string().max(1000).optional(),
});

/**
 * POST /api/reports — file a report about a user, team, or league.
 *
 * The report is persisted and emailed to the support address. The email is the
 * part that matters: guideline 1.2 expects reports to be acted on promptly, and
 * a row in a table with no admin UI would not be.
 */
router.post('/reports', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const data = ReportSchema.parse(req.body);
    const reporterId = req.userId!;

    // One open report per reporter per target. Crude rate limiting, and it
    // stops a frustrated user filing the same complaint twenty times.
    const existing = await prisma.contentReport.findFirst({
      where: {
        reporterId,
        targetType: data.targetType,
        targetId: data.targetId,
        status: 'open',
      },
    });
    if (existing) {
      res.json({ ok: true, alreadyReported: true });
      return;
    }

    const report = await prisma.contentReport.create({
      data: { ...data, reporterId },
    });

    const reporter = await prisma.user.findUnique({
      where: { id: reporterId },
      select: { username: true, email: true },
    });

    // Never let a mail failure fail the report — the row is already saved, and
    // the user has been told we received it.
    void sendEmail({
      to: SUPPORT_EMAIL,
      subject: `[Bandwagoner] ${data.reason} report on ${data.targetType}`,
      html: `<p>New content report.</p>
<ul>
<li><strong>Report ID:</strong> ${report.id}</li>
<li><strong>Target:</strong> ${data.targetType} ${data.targetId}</li>
<li><strong>Reason:</strong> ${data.reason}</li>
<li><strong>Reporter:</strong> ${reporter?.username ?? 'unknown'} (${reporter?.email ?? 'unknown'})</li>
</ul>
<p><strong>Details:</strong> ${data.details ? escapeHtml(data.details) : 'none given'}</p>`,
    }).catch((err) => console.error('[moderation] report email failed', err));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** POST /api/users/:id/block */
router.post('/users/:id/block', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const blockerId = req.userId!;
    const blockedId = req.params.id;
    if (blockerId === blockedId) {
      res.status(400).json({ error: "You can't block yourself" });
      return;
    }
    const target = await prisma.user.findFirst({
      where: { id: blockedId, deletedAt: null },
      select: { id: true },
    });
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    // Idempotent: blocking twice is a no-op rather than a unique-constraint 500.
    await prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/users/:id/block */
router.delete('/users/:id/block', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await prisma.userBlock.deleteMany({
      where: { blockerId: req.userId!, blockedId: req.params.id },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET /api/users/blocks — the viewer's block list, for the Account Settings screen. */
router.get('/users/blocks', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.userBlock.findMany({
      where: { blockerId: req.userId! },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        blocked: { select: { id: true, username: true, avatarUrl: true } },
      },
    });
    res.json(
      rows.map((r) => ({
        id: r.blocked.id,
        username: r.blocked.username,
        avatarUrl: r.blocked.avatarUrl,
        blockedAt: r.createdAt,
      })),
    );
  } catch (err) {
    next(err);
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default router;
