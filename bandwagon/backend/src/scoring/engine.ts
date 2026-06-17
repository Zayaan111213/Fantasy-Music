import { prisma } from '../db/prisma';
import type { DataProvider } from '../data/provider';
import { scoreChartPosition, scoreChartMovement, scoreStreaming, ScoringConfigSchema, CHART_POSITION_TIERS, type ScoringConfig } from './tiers';

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
      artistId,
      week,
      seasonYear: year,
      streamingPoints,
      chartPositionPoints,
      chartMovementPoints,
      totalPoints,
      weeklyStreams: streams !== null ? BigInt(streams) : null,
      bestChartPosition: position,
      chartMovement: movement,
      dataMissing: missing.length ? missing.join(',') : null,
    },
    update: {
      streamingPoints,
      chartPositionPoints,
      chartMovementPoints,
      totalPoints,
      weeklyStreams: streams !== null ? BigInt(streams) : null,
      bestChartPosition: position,
      chartMovement: movement,
      dataMissing: missing.length ? missing.join(',') : null,
    },
  });
}

export function applyCustomScoringToWeeklyScore(
  ws: { weeklyStreams: bigint | null; bestChartPosition: number | null; chartMovement: number | null },
  genre: string,
  genreTiers: { minStreams: bigint; maxStreams: bigint | null; points: number }[],
  cfg: ScoringConfig
): { streamingPoints: number; chartPositionPoints: number; chartMovementPoints: number; totalPoints: number } {
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
  return { streamingPoints, chartPositionPoints, chartMovementPoints, totalPoints: streamingPoints + chartPositionPoints + chartMovementPoints };
}

export async function updateMatchupScores(leagueId: string, week: number, year: number): Promise<void> {
  const [matchup, leagueRow] = await Promise.all([
    prisma.matchup.findFirst({
      where: { leagueId, week },
      include: {
        homeTeam: {
          include: {
            rosterSpots: {
              where: { slot: { not: { startsWith: 'Bench' } } },
              include: { artist: { select: { primaryGenre: true } } },
            },
          },
        },
        awayTeam: {
          include: {
            rosterSpots: {
              where: { slot: { not: { startsWith: 'Bench' } } },
              include: { artist: { select: { primaryGenre: true } } },
            },
          },
        },
      },
    }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { scoringConfig: true } }),
  ]);
  if (!matchup) return;

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
    const genreTiers = genreTierCache.get(g)!;
    return applyCustomScoringToWeeklyScore(ws, g, genreTiers, cfg).totalPoints;
  }

  async function teamScore(spots: { artistId: string | null; artist: { primaryGenre: string } | null }[]): Promise<number> {
    let total = 0;
    for (const spot of spots) total += await spotScore(spot.artistId, spot.artist?.primaryGenre ?? null);
    return total;
  }

  const [homeScore, awayScore] = await Promise.all([
    teamScore(matchup.homeTeam.rosterSpots),
    teamScore(matchup.awayTeam.rosterSpots),
  ]);

  await prisma.matchup.update({ where: { id: matchup.id }, data: { homeScore, awayScore } });
}
