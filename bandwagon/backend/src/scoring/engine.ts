import { prisma } from '../db/prisma';
import type { DataProvider } from '../data/provider';
import { scoreChartPosition, scoreChartMovement, scoreStreaming } from './tiers';

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

export async function updateMatchupScores(leagueId: string, week: number, year: number): Promise<void> {
  const matchup = await prisma.matchup.findFirst({
    where: { leagueId, week },
    include: {
      homeTeam: { include: { rosterSpots: { where: { slot: { not: { startsWith: 'Bench' } } } } } },
      awayTeam: { include: { rosterSpots: { where: { slot: { not: { startsWith: 'Bench' } } } } } },
    },
  });
  if (!matchup) return;

  async function teamScore(spots: { artistId: string | null }[]): Promise<number> {
    let total = 0;
    for (const spot of spots) {
      if (!spot.artistId) continue;
      const ws = await prisma.weeklyScore.findUnique({
        where: { artistId_week_seasonYear: { artistId: spot.artistId, week, seasonYear: year } },
      });
      total += ws?.totalPoints ?? 0;
    }
    return total;
  }

  const homeScore = await teamScore(matchup.homeTeam.rosterSpots);
  const awayScore = await teamScore(matchup.awayTeam.rosterSpots);

  await prisma.matchup.update({
    where: { id: matchup.id },
    data: { homeScore, awayScore },
  });
}
