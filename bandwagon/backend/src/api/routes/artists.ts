import { Router } from 'express';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../middleware/auth';
import { ScoringConfigSchema } from '../../scoring/tiers';
import { applyCustomScoringToWeeklyScore } from '../../scoring/engine';

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
    const leagueId = req.query.leagueId as string | undefined;

    const leagueRow = leagueId
      ? await prisma.league.findUnique({
          where: { id: leagueId },
          select: { scoringConfig: true, currentWeek: true, seasonYear: true },
        })
      : null;

    const seasonYear = leagueRow?.seasonYear ?? 2026;
    // Without a league, find the latest week with real chart-based scores (streamingPoints=0 means pipeline-scored)
    const currentWeek = leagueRow?.currentWeek ?? (await prisma.weeklyScore.aggregate({
      where: { seasonYear, streamingPoints: 0, chartPositionPoints: { gt: 0 } },
      _max: { week: true },
    }))._max.week ?? 1;

    const artist = await prisma.artist.findUnique({
      where: { id: req.params.id },
      include: {
        weeklyScores: {
          where: { seasonYear, week: { lte: currentWeek } },
          orderBy: { week: 'desc' },
        },
      },
    });
    if (!artist) { res.status(404).json({ error: 'Artist not found' }); return; }

    const cfg = leagueRow ? ScoringConfigSchema.safeParse(leagueRow.scoringConfig).data ?? null : null;

    if (!cfg) {
      res.json(artist);
      return;
    }

    const genreRows = await prisma.genreStreamingTier.findMany({ where: { genre: artist.primaryGenre }, orderBy: { sortOrder: 'asc' } });
    const genreTiers = genreRows.length
      ? genreRows
      : await prisma.genreStreamingTier.findMany({ where: { genre: 'Pop' }, orderBy: { sortOrder: 'asc' } });

    const adjustedWeeklyScores = artist.weeklyScores.map((ws) => {
      const adjusted = applyCustomScoringToWeeklyScore(ws, artist.primaryGenre, genreTiers, cfg);
      return { ...ws, ...adjusted };
    });

    res.json({ ...artist, weeklyScores: adjustedWeeklyScores });
  } catch (err) {
    next(err);
  }
});

export default router;
