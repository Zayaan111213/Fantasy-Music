import { Router } from 'express';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../middleware/auth';
import {
  ScoringConfigSchema,
  scoreChartPosition,
  scoreChartMovement,
  ALBUM_CHART_POSITION_TIERS,
  DEFAULT_SONG_MOVEMENT,
  DEFAULT_ALBUM_MOVEMENT,
} from '../../scoring/tiers';
import { applyCustomScoringToWeeklyScore } from '../../scoring/engine';

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q as string) || '';
    const genre = req.query.genre as string | undefined;
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = Math.min(parseInt((req.query.limit as string) || '40', 10), 5000);

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

    // Build chart breakdown for the latest scored week (song + album, position + movement)
    let chartBreakdown: {
      song: { rank: number; title: string; movement: number | null; isDebut: boolean; positionPoints: number; movementPoints: number } | null;
      album: { rank: number; title: string; movement: number | null; isDebut: boolean; positionPoints: number; movementPoints: number } | null;
    } | null = null;

    const [bestSong, bestAlbum] = await Promise.all([
      prisma.chartEntry.findFirst({
        where: { artistId: artist.id },
        orderBy: [{ weekDate: 'desc' }, { rank: 'asc' }],
      }),
      prisma.albumChartEntry.findFirst({
        where: { artistId: artist.id },
        orderBy: [{ weekDate: 'desc' }, { rank: 'asc' }],
      }),
    ]);

    if (bestSong || bestAlbum) {
      const weekDate = (bestSong?.weekDate ?? bestAlbum!.weekDate) as Date;
      const priorDate = new Date(weekDate.getTime() - 7 * 24 * 60 * 60 * 1000);

      let songMovement: number | null = null;
      let songIsDebut = false;
      if (bestSong) {
        const priorSong = bestSong.appleSongId
          ? await prisma.chartEntry.findFirst({ where: { weekDate: priorDate, chart: bestSong.chart, appleSongId: bestSong.appleSongId } })
          : await prisma.chartEntry.findFirst({ where: { weekDate: priorDate, chart: bestSong.chart, songTitle: bestSong.songTitle } });
        songIsDebut = priorSong === null;
        songMovement = priorSong !== null ? priorSong.rank - bestSong.rank : null;
      }

      let albumMovement: number | null = null;
      let albumIsDebut = false;
      if (bestAlbum) {
        const priorAlbum = bestAlbum.appleAlbumId
          ? await prisma.albumChartEntry.findFirst({ where: { weekDate: priorDate, chart: bestAlbum.chart, appleAlbumId: bestAlbum.appleAlbumId } })
          : await prisma.albumChartEntry.findFirst({ where: { weekDate: priorDate, chart: bestAlbum.chart, albumTitle: bestAlbum.albumTitle } });
        albumIsDebut = priorAlbum === null;
        albumMovement = priorAlbum !== null ? priorAlbum.rank - bestAlbum.rank : null;
      }

      chartBreakdown = {
        song: bestSong ? {
          rank: bestSong.rank,
          title: bestSong.songTitle,
          movement: songMovement,
          isDebut: songIsDebut,
          positionPoints: scoreChartPosition(bestSong.rank),
          movementPoints: scoreChartMovement(songMovement, songIsDebut, DEFAULT_SONG_MOVEMENT),
        } : null,
        album: bestAlbum ? {
          rank: bestAlbum.rank,
          title: bestAlbum.albumTitle,
          movement: albumMovement,
          isDebut: albumIsDebut,
          positionPoints: scoreChartPosition(bestAlbum.rank, ALBUM_CHART_POSITION_TIERS),
          movementPoints: scoreChartMovement(albumMovement, albumIsDebut, DEFAULT_ALBUM_MOVEMENT),
        } : null,
      };
    }

    // Recompute totalPoints from the live chartBreakdown so the total always
    // matches the displayed breakdown bars, even between daily pipeline runs.
    // If the artist isn't on either chart right now, longevity/total must be 0 too —
    // otherwise a stale WeeklyScore row (from before it fell off the charts) gets
    // shown next to "no chart entry this week" messaging.
    let weeklyScores = artist.weeklyScores;
    if (weeklyScores.length > 0) {
      const longevityPoints = chartBreakdown ? (weeklyScores[0].longevityPoints ?? 0) : 0;
      // Movement points are signed (a rank drop is a real penalty per the scoring
      // spec) — don't floor at 0, or the total silently under-counts the drop.
      const computedTotal =
        (chartBreakdown?.song?.positionPoints ?? 0) +
        (chartBreakdown?.song?.movementPoints ?? 0) +
        (chartBreakdown?.album?.positionPoints ?? 0) +
        (chartBreakdown?.album?.movementPoints ?? 0) +
        longevityPoints;
      weeklyScores = [{ ...weeklyScores[0], longevityPoints, totalPoints: computedTotal }, ...weeklyScores.slice(1)];
    }

    const cfg = leagueRow ? ScoringConfigSchema.safeParse(leagueRow.scoringConfig).data ?? null : null;

    if (!cfg) {
      res.json({ ...artist, weeklyScores, chartBreakdown });
      return;
    }

    const genreRows = await prisma.genreStreamingTier.findMany({ where: { genre: artist.primaryGenre }, orderBy: { sortOrder: 'asc' } });
    const genreTiers = genreRows.length
      ? genreRows
      : await prisma.genreStreamingTier.findMany({ where: { genre: 'Pop' }, orderBy: { sortOrder: 'asc' } });

    const adjustedWeeklyScores = weeklyScores.map((ws) => {
      const adjusted = applyCustomScoringToWeeklyScore(ws, artist.primaryGenre, genreTiers, cfg);
      return { ...ws, ...adjusted };
    });

    res.json({ ...artist, weeklyScores: adjustedWeeklyScores, chartBreakdown });
  } catch (err) {
    next(err);
  }
});

export default router;
