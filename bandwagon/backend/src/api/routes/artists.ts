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
        weeklyScores: { orderBy: { weekDate: 'desc' }, take: 5 },
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
    const weeklyScores = weekDatesDesc.map((weekDate, i) => ({
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

    // Chart breakdown for the newest ingested chart week, derived from the
    // same live computation as the history row above — never from the
    // artist's own latest entry in some older week. An artist that fell off
    // this week's charts shows empty song/album sections and a 0 total,
    // matching the player lists (which read the stored current-week row).
    const current = breakdowns.length > 0 ? breakdowns[0] : null;
    // null (not { song: null, album: null }) when off both charts — the
    // frontend keys its "not on the charts this week" state off that.
    const chartBreakdown = current && (current.songRank !== null || current.albumRank !== null)
      ? {
          song: current.songRank !== null ? {
            rank: current.songRank,
            title: current.songTitle!,
            movement: current.songMovement,
            isDebut: current.songIsDebut,
            positionPoints: current.songPositionPoints,
            movementPoints: current.songMovementPoints,
          } : null,
          album: current.albumRank !== null ? {
            rank: current.albumRank,
            title: current.albumTitle!,
            movement: current.albumMovement,
            isDebut: current.albumIsDebut,
            positionPoints: current.albumPositionPoints,
            movementPoints: current.albumMovementPoints,
          } : null,
        }
      : null;

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
