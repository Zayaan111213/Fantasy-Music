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
import { applyCustomScoringToWeeklyScore, computeChartScoreForWeek } from '../../scoring/engine';
import { getCurrentWeekDate } from '../../jobs/ingestCharts';
import { genreFilterToWhere } from './leagues';

const router = Router();

// How many of the artist's most recent real chart weeks to show on its detail
// page — independent of any league's own week counter, so an artist that's
// been charting longer than a given league has existed still shows its
// actual history (or fewer, if it hasn't charted that many weeks yet).
const HISTORY_WEEKS = 10;

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q as string) || '';
    const genre = req.query.genre as string | undefined;
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = Math.min(parseInt((req.query.limit as string) || '40', 10), 5000);

    const artists = await prisma.artist.findMany({
      where: {
        hiddenAt: null, // retired combined credits stay out of the player pool
        ...(q && { name: { contains: q, mode: 'insensitive' } }),
        ...(genre && genreFilterToWhere(genre)),
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
          select: { scoringConfig: true },
        })
      : null;

    const artist = await prisma.artist.findUnique({ where: { id: req.params.id } });
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
          ? await prisma.chartEntry.findFirst({ where: { weekDate: priorDate, chart: bestSong.chart, artistId: artist.id, appleSongId: bestSong.appleSongId } })
          : await prisma.chartEntry.findFirst({ where: { weekDate: priorDate, chart: bestSong.chart, artistId: artist.id, songTitle: bestSong.songTitle } });
        songIsDebut = priorSong === null;
        songMovement = priorSong !== null ? priorSong.rank - bestSong.rank : null;
      }

      let albumMovement: number | null = null;
      let albumIsDebut = false;
      if (bestAlbum) {
        const priorAlbum = bestAlbum.appleAlbumId
          ? await prisma.albumChartEntry.findFirst({ where: { weekDate: priorDate, chart: bestAlbum.chart, artistId: artist.id, appleAlbumId: bestAlbum.appleAlbumId } })
          : await prisma.albumChartEntry.findFirst({ where: { weekDate: priorDate, chart: bestAlbum.chart, artistId: artist.id, albumTitle: bestAlbum.albumTitle } });
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

    // Season history: the app's last HISTORY_WEEKS real calendar chart weeks,
    // computed straight from ChartEntry/AlbumChartEntry — not read off the
    // WeeklyScore table, whose `week` numbering is relative to whichever league
    // happened to be scoring it. Deliberately NOT filtered to the artist's own
    // weeks: weeks where the artist missed both charts still appear, scored 0,
    // so the history reads "on the chart / off the chart" week by week instead
    // of silently skipping the misses.
    const [songWeeks, albumWeeks] = await Promise.all([
      prisma.chartEntry.findMany({
        select: { weekDate: true },
        distinct: ['weekDate'],
        orderBy: { weekDate: 'desc' },
        take: HISTORY_WEEKS,
      }),
      prisma.albumChartEntry.findMany({
        select: { weekDate: true },
        distinct: ['weekDate'],
        orderBy: { weekDate: 'desc' },
        take: HISTORY_WEEKS,
      }),
    ]);
    const weekDateByKey = new Map<string, Date>();
    for (const { weekDate } of [...songWeeks, ...albumWeeks]) {
      weekDateByKey.set(weekDate.toISOString(), weekDate);
    }
    const weekDatesDesc = [...weekDateByKey.values()]
      .sort((a, b) => b.getTime() - a.getTime())
      .slice(0, HISTORY_WEEKS);

    const breakdowns = await Promise.all(
      weekDatesDesc.map((weekDate) => computeChartScoreForWeek(artist.id, weekDate)),
    );
    const currentWeekDate = getCurrentWeekDate();
    const n = weekDatesDesc.length;
    let weeklyScores = weekDatesDesc.map((weekDate, i) => ({
      id: `${artist.id}-${weekDate.toISOString().slice(0, 10)}`,
      artistId: artist.id,
      week: n - i,
      weekDate: weekDate.toISOString().slice(0, 10),
      seasonYear: weekDate.getUTCFullYear(),
      streamingPoints: 0,
      weeklyStreams: null as bigint | null,
      isFinalized: weekDate.getTime() !== currentWeekDate.getTime(),
      ...breakdowns[i],
    }));

    // Recompute totalPoints from the live chartBreakdown so the total always
    // matches the displayed breakdown bars, even between daily pipeline runs.
    // If the artist isn't on either chart right now, longevity/total must be 0 too —
    // otherwise a stale WeeklyScore row (from before it fell off the charts) gets
    // shown next to "no chart entry this week" messaging.
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
