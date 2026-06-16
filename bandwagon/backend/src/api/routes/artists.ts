import { Router } from 'express';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q as string) || '';
    const genre = req.query.genre as string | undefined;
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = 40;

    const artists = await prisma.artist.findMany({
      where: {
        ...(q && { name: { contains: q, mode: 'insensitive' } }),
        ...(genre && { primaryGenre: genre }),
      },
      include: {
        weeklyScores: { orderBy: { week: 'desc' }, take: 5 },
      },
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    res.json(artists.map((a) => ({
      ...a,
      weeklyScores: undefined,
      lastWeekPoints: a.weeklyScores[0]?.totalPoints ?? 0,
      avgLast5Points: a.weeklyScores.length > 0
        ? a.weeklyScores.reduce((s, w) => s + w.totalPoints, 0) / a.weeklyScores.length
        : 0,
    })));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const artist = await prisma.artist.findUnique({
      where: { id: req.params.id },
      include: {
        weeklyScores: {
          orderBy: { week: 'desc' },
        },
      },
    });
    if (!artist) { res.status(404).json({ error: 'Artist not found' }); return; }
    res.json(artist);
  } catch (err) {
    next(err);
  }
});

export default router;
