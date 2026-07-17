import { Router } from 'express';
import { prisma } from '../../db/prisma';
import { requireAuth, type AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.userId!, seenAt: null },
      orderBy: { createdAt: 'desc' },
    });
    res.json(notifications);
  } catch (err) {
    next(err);
  }
});

// Merged recent activity across every league the user belongs to — the Home
// page's cross-league feed. League-scoped events + the user's own
// notifications, newest first, each tagged with its league name.
router.get('/activity', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const teams = await prisma.team.findMany({
      where: { userId: req.userId! },
      select: { leagueId: true, league: { select: { name: true } } },
    });
    if (teams.length === 0) {
      res.json({ items: [] });
      return;
    }
    const leagueIds = teams.map((t) => t.leagueId);
    const nameOf = new Map(teams.map((t) => [t.leagueId, t.league.name]));

    const [events, personal] = await Promise.all([
      prisma.leagueEvent.findMany({
        where: { leagueId: { in: leagueIds } },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
      prisma.notification.findMany({
        where: { userId: req.userId!, leagueId: { in: leagueIds } },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
    ]);

    const items = [
      ...events.map((e) => ({
        id: e.id,
        kind: 'league' as const,
        type: e.type,
        message: e.message,
        leagueId: e.leagueId,
        leagueName: nameOf.get(e.leagueId) ?? '',
        createdAt: e.createdAt,
      })),
      ...personal.map((n) => ({
        id: n.id,
        kind: 'personal' as const,
        type: n.type,
        message: n.message,
        leagueId: n.leagueId!,
        leagueName: nameOf.get(n.leagueId!) ?? '',
        createdAt: n.createdAt,
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 30);

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/dismiss', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const notif = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notif || notif.userId !== req.userId) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await prisma.notification.update({
      where: { id: req.params.id },
      data: { seenAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
