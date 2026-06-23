import { prisma } from '../db/prisma';

async function bestArtistScore(teamId: string, week: number, year: number): Promise<number> {
  const spots = await prisma.rosterSpot.findMany({
    where: { teamId, slot: { not: { startsWith: 'Bench' } }, artistId: { not: null } },
    select: { artistId: true },
  });
  const scores = await Promise.all(
    spots.map(({ artistId }) =>
      prisma.weeklyScore.findUnique({
        where: { artistId_week_seasonYear: { artistId: artistId!, week, seasonYear: year } },
        select: { totalPoints: true },
      }),
    ),
  );
  return Math.max(0, ...scores.map((s) => s?.totalPoints ?? 0));
}

async function resolveWinner(
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number,
  awayScore: number,
  week: number,
  year: number,
): Promise<string | null> {
  if (homeScore !== awayScore) {
    return homeScore > awayScore ? homeTeamId : awayTeamId;
  }
  // Tiebreaker: highest single artist score among starters
  const [homeBest, awayBest] = await Promise.all([
    bestArtistScore(homeTeamId, week, year),
    bestArtistScore(awayTeamId, week, year),
  ]);
  if (homeBest !== awayBest) return homeBest > awayBest ? homeTeamId : awayTeamId;
  return null; // true tie
}

async function main(): Promise<void> {
  const leagues = await prisma.league.findMany({
    where: { status: 'active' },
    select: { id: true, currentWeek: true, seasonYear: true },
  });

  for (const { id: leagueId, currentWeek: week, seasonYear: year } of leagues) {
    const matchups = await prisma.matchup.findMany({
      where: { leagueId, week, isFinalized: false },
    });

    let finalizedCount = 0;
    for (const m of matchups) {
      const winnerId = await resolveWinner(
        m.homeTeamId, m.awayTeamId, m.homeScore, m.awayScore, week, year,
      );
      await prisma.matchup.update({
        where: { id: m.id },
        data: { isFinalized: true, winnerId },
      });
      console.log(`[finalize] matchup ${m.id} → winner ${winnerId ?? 'tie'}`);
      finalizedCount++;
    }

    if (finalizedCount > 0) {
      // Cap at 10 for regular season
      const nextWeek = Math.min(week + 1, 10);
      await prisma.league.update({ where: { id: leagueId }, data: { currentWeek: nextWeek } });
      console.log(`[finalize] league ${leagueId} week ${week} → ${nextWeek}`);
    } else {
      console.log(`[finalize] league ${leagueId} week ${week} — already finalized, skipped`);
    }
  }

  console.log('[finalize] done');
}

main()
  .catch((err) => { console.error('[finalize] fatal:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
