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
