import { prisma } from '../db/prisma';
import type { DataProvider } from '../data/provider';
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
// Mock-provider-based scoring (kept for seed / testing)
// ---------------------------------------------------------------------------

export async function scoreArtistWeek(
  artistId: string,
  week: number,
  year: number,
  genre: string,
  provider: DataProvider
): Promise<void> {
  const genreTiers = await prisma.genreStreamingTier.findMany({
    where: { genre },
    orderBy: { sortOrder: 'asc' },
  });
  const fallbackTiers = genreTiers.length ? genreTiers : await prisma.genreStreamingTier.findMany({
    where: { genre: 'Pop' },
    orderBy: { sortOrder: 'asc' },
  });

  const tiersForScoring = fallbackTiers.map((t) => ({
    minStreams: t.minStreams,
    maxStreams: t.maxStreams,
    points: t.points,
  }));

  const missing: string[] = [];

  const streams = await provider.getWeeklyStreams(artistId, week, year);
  if (streams === null) missing.push('streams');
  const streamingPoints = streams !== null ? scoreStreaming(streams, tiersForScoring) : 0;

  const position = await provider.getBestChartPosition(artistId, week, year);
  if (position === null && streams !== null) missing.push('chartPosition');
  const chartPositionPoints = scoreChartPosition(position);

  const movement = await provider.getChartMovement(artistId, week, year);
  const isNewEntry = position !== null && week === 1;
  const chartMovementPoints = scoreChartMovement(movement, isNewEntry);

  const totalPoints = streamingPoints + chartPositionPoints + chartMovementPoints;

  await prisma.weeklyScore.upsert({
    where: { artistId_week_seasonYear: { artistId, week, seasonYear: year } },
    create: {
      artistId, week, seasonYear: year,
      streamingPoints, chartPositionPoints, chartMovementPoints, totalPoints,
      weeklyStreams: streams !== null ? BigInt(streams) : null,
      bestChartPosition: position,
      chartMovement: movement,
      dataMissing: missing.length ? missing.join(',') : null,
    },
    update: {
      streamingPoints, chartPositionPoints, chartMovementPoints, totalPoints,
      weeklyStreams: streams !== null ? BigInt(streams) : null,
      bestChartPosition: position,
      chartMovement: movement,
      dataMissing: missing.length ? missing.join(',') : null,
    },
  });
}

// ---------------------------------------------------------------------------
// Chart-data-based scoring (reads ChartEntry / AlbumChartEntry)
// ---------------------------------------------------------------------------

function priorWeek(weekDate: Date): Date {
  return new Date(weekDate.getTime() - 7 * 24 * 60 * 60 * 1000);
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
    const priorSong = bestSong.appleSongId
      ? await prisma.chartEntry.findFirst({
          where: { weekDate: prior, chart: bestSong.chart, appleSongId: bestSong.appleSongId },
        })
      : await prisma.chartEntry.findFirst({
          where: { weekDate: prior, chart: bestSong.chart, songTitle: bestSong.songTitle },
        });
    songIsDebut = priorSong === null;
    songMovement = priorSong !== null ? priorSong.rank - bestSong.rank : null;
    songMovementPoints = scoreChartMovement(songMovement, songIsDebut, DEFAULT_SONG_MOVEMENT);
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
          where: { weekDate: prior, chart: bestAlbum.chart, appleAlbumId: bestAlbum.appleAlbumId },
        })
      : await prisma.albumChartEntry.findFirst({
          where: { weekDate: prior, chart: bestAlbum.chart, albumTitle: bestAlbum.albumTitle },
        });
    albumIsDebut = priorAlbum === null;
    albumMovement = priorAlbum !== null ? priorAlbum.rank - bestAlbum.rank : null;
    albumMovementPoints = scoreChartMovement(albumMovement, albumIsDebut, DEFAULT_ALBUM_MOVEMENT);
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
  week: number,
  year: number,
  weekDate: Date,
): Promise<void> {
  const breakdown = await computeChartScoreForWeek(artistId, weekDate);

  await prisma.weeklyScore.upsert({
    where: { artistId_week_seasonYear: { artistId, week, seasonYear: year } },
    create: { artistId, week, seasonYear: year, streamingPoints: 0, ...breakdown },
    update: { streamingPoints: 0, ...breakdown },
  });
}

export async function scoreAllArtistsForWeek(
  week: number,
  year: number,
  weekDate: Date,
): Promise<void> {
  // Score every artist, not just ones on this week's chart — an artist that fell
  // off both charts still needs a fresh WeeklyScore row (with zeroed position/
  // movement/longevity) so every page reading WeeklyScore directly (Players tab,
  // My Team, standings/matchups) reflects that, not a stale prior-week total.
  const allArtists = await prisma.artist.findMany({ select: { id: true } });

  console.log(`Scoring ${allArtists.length} artists for week ${week}/${year} (${weekDate.toISOString().slice(0, 10)})...`);
  for (const { id: artistId } of allArtists) {
    await scoreArtistWeekFromCharts(artistId, week, year, weekDate);
  }
  console.log('Artist scoring complete.');
}

// ---------------------------------------------------------------------------
// Custom-scoring override (league commissioner settings)
// ---------------------------------------------------------------------------

export function applyCustomScoringToWeeklyScore(
  ws: { weeklyStreams: bigint | null; bestChartPosition: number | null; chartMovement: number | null; longevityPoints?: number },
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
  const chartMovementPoints = scoreChartMovement(ws.chartMovement, isNewEntry, cfg.chartMovement);
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

export async function updateMatchupScores(leagueId: string, week: number, year: number): Promise<void> {
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
      where: { artistId_week_seasonYear: { artistId, week, seasonYear: year } },
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
