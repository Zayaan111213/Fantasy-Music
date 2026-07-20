import { prisma } from '../db/prisma';
import { getCurrentWeekDate } from '../jobs/ingestCharts';
import {
  scoreChartPosition,
  scoreChartMovement,
  scoreStreaming,
  scoreLongevity,
  ScoringConfigSchema,
  CHART_POSITION_TIERS,
  ALBUM_CHART_POSITION_TIERS,
  DEFAULT_SONG_MOVEMENT,
  DEFAULT_ALBUM_MOVEMENT,
  type ScoringConfig,
} from './tiers';

// ---------------------------------------------------------------------------
// Chart-data-based scoring (reads ChartEntry / AlbumChartEntry)
// ---------------------------------------------------------------------------

function priorWeek(weekDate: Date): Date {
  return new Date(weekDate.getTime() - 7 * 24 * 60 * 60 * 1000);
}

// Translates a league's week number to the real chart week (the Tuesday it
// started). WeeklyScore rows are keyed by calendar weekDate — league week
// numbers are per-league counters, and two leagues that started on different
// dates give the same number to different calendar weeks. Anchored on the
// current chart week (exactly how the daily pipeline writes: currentWeek is
// always scored against getCurrentWeekDate()), counting back 7 days per week.
export function weekDateForLeagueWeek(
  currentWeek: number,
  week: number,
  currentWeekDate: Date = getCurrentWeekDate(),
): Date {
  return new Date(currentWeekDate.getTime() - (currentWeek - week) * 7 * 24 * 60 * 60 * 1000);
}

export interface ChartScoreBreakdown {
  songRank: number | null;
  songTitle: string | null;
  songPositionPoints: number;
  songMovement: number | null;
  songMovementPoints: number;
  songIsDebut: boolean;
  albumRank: number | null;
  albumTitle: string | null;
  albumPositionPoints: number;
  albumMovement: number | null;
  albumMovementPoints: number;
  albumIsDebut: boolean;
  chartPositionPoints: number;
  chartMovementPoints: number;
  longevityPoints: number;
  totalPoints: number;
  bestChartPosition: number | null;
  chartMovement: number | null;
  dataMissing: string | null;
}

// Pure read: computes an artist's chart-based score for an arbitrary weekDate
// straight from ChartEntry/AlbumChartEntry, with no dependency on any league's
// week counter and no DB write. Shared by scoreArtistWeekFromCharts (which
// persists the result against a specific league week) and the artist-detail
// route's history view (which needs scores for real calendar weeks that may
// predate any league's own week numbering).
export async function computeChartScoreForWeek(
  artistId: string,
  weekDate: Date,
): Promise<ChartScoreBreakdown> {
  const prior = priorWeek(weekDate);

  // --- Songs ---
  const songs = await prisma.chartEntry.findMany({
    where: { artistId, weekDate },
    orderBy: { rank: 'asc' },
  });
  const bestSong = songs[0] ?? null;
  const songPositionPoints = scoreChartPosition(bestSong?.rank ?? null);

  let songMovementPoints = 0;
  let songMovement: number | null = null;
  let songIsDebut = false;
  if (bestSong) {
    // artistId scope matters: joint credits create one row per credited artist,
    // so the same appleSongId exists for multiple artists in a week.
    const priorSong = bestSong.appleSongId
      ? await prisma.chartEntry.findFirst({
          where: { weekDate: prior, chart: bestSong.chart, artistId, appleSongId: bestSong.appleSongId },
        })
      : await prisma.chartEntry.findFirst({
          where: { weekDate: prior, chart: bestSong.chart, artistId, songTitle: bestSong.songTitle },
        });
    songIsDebut = priorSong === null;
    songMovement = priorSong !== null ? priorSong.rank - bestSong.rank : null;
    songMovementPoints = scoreChartMovement(songMovement, songIsDebut, DEFAULT_SONG_MOVEMENT);
  } else {
    // Fell off the songs chart: was on it last week, gone this week — the
    // maximum drop penalty, symmetric with the +10 debut bonus.
    const priorCount = await prisma.chartEntry.count({ where: { artistId, weekDate: prior } });
    if (priorCount > 0) songMovementPoints = -DEFAULT_SONG_MOVEMENT.maxDrop;
  }

  // --- Albums ---
  const albums = await prisma.albumChartEntry.findMany({
    where: { artistId, weekDate },
    orderBy: { rank: 'asc' },
  });
  const bestAlbum = albums[0] ?? null;
  const albumPositionPoints = scoreChartPosition(bestAlbum?.rank ?? null, ALBUM_CHART_POSITION_TIERS);

  let albumMovementPoints = 0;
  let albumMovement: number | null = null;
  let albumIsDebut = false;
  if (bestAlbum) {
    const priorAlbum = bestAlbum.appleAlbumId
      ? await prisma.albumChartEntry.findFirst({
          where: { weekDate: prior, chart: bestAlbum.chart, artistId, appleAlbumId: bestAlbum.appleAlbumId },
        })
      : await prisma.albumChartEntry.findFirst({
          where: { weekDate: prior, chart: bestAlbum.chart, artistId, albumTitle: bestAlbum.albumTitle },
        });
    albumIsDebut = priorAlbum === null;
    albumMovement = priorAlbum !== null ? priorAlbum.rank - bestAlbum.rank : null;
    albumMovementPoints = scoreChartMovement(albumMovement, albumIsDebut, DEFAULT_ALBUM_MOVEMENT);
  } else {
    const priorCount = await prisma.albumChartEntry.count({ where: { artistId, weekDate: prior } });
    if (priorCount > 0) albumMovementPoints = -DEFAULT_ALBUM_MOVEMENT.maxDrop;
  }

  const chartPositionPoints = songPositionPoints + albumPositionPoints;
  const chartMovementPoints = songMovementPoints + albumMovementPoints;

  // Longevity: count consecutive weeks this artist has been on either chart
  const onChartThisWeek = songs.length > 0 || albums.length > 0;
  let consecutiveWeeks = onChartThisWeek ? 1 : 0;
  if (onChartThisWeek) {
    for (let w = 1; w <= 5; w++) {
      const priorDate = new Date(weekDate.getTime() - w * 7 * 24 * 60 * 60 * 1000);
      const [sc, ac] = await Promise.all([
        prisma.chartEntry.count({ where: { artistId, weekDate: priorDate } }),
        prisma.albumChartEntry.count({ where: { artistId, weekDate: priorDate } }),
      ]);
      if (sc + ac > 0) { consecutiveWeeks++; } else { break; }
    }
  }
  const longevityPoints = scoreLongevity(consecutiveWeeks);

  const totalPoints = chartPositionPoints + chartMovementPoints + longevityPoints;

  return {
    songRank: bestSong?.rank ?? null,
    songTitle: bestSong?.songTitle ?? null,
    songPositionPoints,
    songMovement,
    songMovementPoints,
    songIsDebut,
    albumRank: bestAlbum?.rank ?? null,
    albumTitle: bestAlbum?.albumTitle ?? null,
    albumPositionPoints,
    albumMovement,
    albumMovementPoints,
    albumIsDebut,
    chartPositionPoints,
    chartMovementPoints,
    longevityPoints,
    totalPoints,
    bestChartPosition: bestSong?.rank ?? bestAlbum?.rank ?? null,
    chartMovement: songMovement,
    dataMissing: songs.length === 0 && albums.length === 0 ? 'charts' : null,
  };
}

export async function scoreArtistWeekFromCharts(
  artistId: string,
  weekDate: Date,
): Promise<void> {
  const breakdown = await computeChartScoreForWeek(artistId, weekDate);

  await prisma.weeklyScore.upsert({
    where: { artistId_weekDate: { artistId, weekDate } },
    create: { artistId, weekDate, streamingPoints: 0, ...breakdown },
    update: { streamingPoints: 0, ...breakdown },
  });
}

export async function scoreAllArtistsForWeek(weekDate: Date): Promise<void> {
  // Score every artist, not just ones on this week's chart — an artist that fell
  // off both charts still needs a fresh WeeklyScore row (with zeroed position/
  // movement/longevity) so every page reading WeeklyScore directly (Players tab,
  // My Team, standings/matchups) reflects that, not a stale prior-week total.
  // Hidden artists (retired combined credits) are skipped — they're history-only.
  const allArtists = await prisma.artist.findMany({ where: { hiddenAt: null }, select: { id: true } });

  console.log(`Scoring ${allArtists.length} artists for chart week ${weekDate.toISOString().slice(0, 10)}...`);
  for (const { id: artistId } of allArtists) {
    await scoreArtistWeekFromCharts(artistId, weekDate);
  }
  console.log('Artist scoring complete.');
}

// ---------------------------------------------------------------------------
// Custom-scoring override (league commissioner settings)
// ---------------------------------------------------------------------------

export function applyCustomScoringToWeeklyScore(
  ws: { weeklyStreams: bigint | null; bestChartPosition: number | null; chartMovement: number | null; longevityPoints?: number; chartMovementPoints?: number },
  genre: string,
  genreTiers: { minStreams: bigint; maxStreams: bigint | null; points: number }[],
  cfg: ScoringConfig
): { streamingPoints: number; chartPositionPoints: number; chartMovementPoints: number; longevityPoints: number; totalPoints: number } {
  const customPts = cfg.streaming[genre] ?? cfg.streaming['Pop'];
  const tiersWithCustomPts = genreTiers.map((t, i) => ({
    minStreams: t.minStreams,
    maxStreams: t.maxStreams,
    points: customPts?.[i] ?? t.points,
  }));
  const customChartTiers = CHART_POSITION_TIERS.map((t, i) => ({ maxPos: t.maxPos, points: cfg.chartPosition[i] }));
  const streams = ws.weeklyStreams !== null ? Number(ws.weeklyStreams) : null;
  const streamingPoints = streams !== null ? scoreStreaming(streams, tiersWithCustomPts) : 0;
  const chartPositionPoints = scoreChartPosition(ws.bestChartPosition, customChartTiers);
  const isNewEntry = ws.chartMovement === null && ws.bestChartPosition !== null;
  let chartMovementPoints = scoreChartMovement(ws.chartMovement, isNewEntry, cfg.chartMovement);
  if (ws.bestChartPosition === null && (ws.chartMovementPoints ?? 0) < 0) {
    // Fell-off-chart penalty week: re-express the default −maxDrop per fallen
    // signal in the league's custom maxDrop.
    const fallenSignals = Math.round(-(ws.chartMovementPoints ?? 0) / 10);
    chartMovementPoints = -cfg.chartMovement.maxDrop * fallenSignals;
  }
  const longevityPoints = ws.longevityPoints ?? 0;
  return { streamingPoints, chartPositionPoints, chartMovementPoints, longevityPoints, totalPoints: streamingPoints + chartPositionPoints + chartMovementPoints + longevityPoints };
}

// ---------------------------------------------------------------------------
// Matchup score rollup (reads WeeklyScore → writes Matchup.homeScore/awayScore)
// ---------------------------------------------------------------------------

const rosterInclude = {
  rosterSpots: {
    where: { slot: { not: { startsWith: 'Bench' } } },
    include: { artist: { select: { primaryGenre: true } } },
  },
} as const;

// week identifies the league's matchups; weekDate identifies the calendar
// chart week whose WeeklyScore rows feed the totals.
export async function updateMatchupScores(leagueId: string, week: number, weekDate: Date): Promise<void> {
  const [matchups, leagueRow] = await Promise.all([
    prisma.matchup.findMany({
      where: { leagueId, week },
      include: {
        homeTeam: { include: rosterInclude },
        awayTeam: { include: rosterInclude },
      },
    }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { scoringConfig: true } }),
  ]);
  if (!matchups.length) return;

  const cfg = ScoringConfigSchema.safeParse(leagueRow?.scoringConfig).data ?? null;
  const genreTierCache = new Map<string, Awaited<ReturnType<typeof prisma.genreStreamingTier.findMany>>>();

  async function spotScore(artistId: string | null, genre: string | null): Promise<number> {
    if (!artistId) return 0;
    const ws = await prisma.weeklyScore.findUnique({
      where: { artistId_weekDate: { artistId, weekDate } },
    });
    if (!ws) return 0;
    if (!cfg) return ws.totalPoints;

    const g = genre ?? 'Pop';
    if (!genreTierCache.has(g)) {
      const rows = await prisma.genreStreamingTier.findMany({ where: { genre: g }, orderBy: { sortOrder: 'asc' } });
      genreTierCache.set(g, rows.length ? rows : await prisma.genreStreamingTier.findMany({ where: { genre: 'Pop' }, orderBy: { sortOrder: 'asc' } }));
    }
    return applyCustomScoringToWeeklyScore(ws, g, genreTierCache.get(g)!, cfg).totalPoints;
  }

  async function teamScore(spots: { artistId: string | null; artist: { primaryGenre: string } | null }[]): Promise<number> {
    let total = 0;
    for (const spot of spots) total += await spotScore(spot.artistId, spot.artist?.primaryGenre ?? null);
    return total;
  }

  await Promise.all(
    matchups.map(async (matchup) => {
      const [homeScore, awayScore] = await Promise.all([
        teamScore(matchup.homeTeam.rosterSpots),
        teamScore(matchup.awayTeam.rosterSpots),
      ]);
      await prisma.matchup.update({ where: { id: matchup.id }, data: { homeScore, awayScore } });
    })
  );
}
