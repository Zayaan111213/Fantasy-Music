import { prisma } from '../db/prisma';
import { getCurrentWeekDate } from './ingestCharts';

export async function bestArtistScore(teamId: string, week: number, year: number): Promise<number> {
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

export async function resolveWinner(
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

export async function finalizeLeagueWeek(leagueId: string, week: number, year: number): Promise<void> {
  // Atomic gate: Postgres serializes concurrent UPDATEs, so a second concurrent run
  // gets count=0 here and skips everything below entirely.
  const { count } = await prisma.matchup.updateMany({
    where: { leagueId, week, isFinalized: false },
    data: { isFinalized: true },
  });

  if (count === 0) {
    console.log(`[finalize] league ${leagueId} week ${week} — already finalized, skipped`);
    return;
  }

  // winnerId varies per matchup so loop after the bulk isFinalized flip.
  // Scores are frozen at this point; same inputs → same winner on any retry of this block.
  const matchups = await prisma.matchup.findMany({ where: { leagueId, week } });
  for (const m of matchups) {
    const winnerId = await resolveWinner(
      m.homeTeamId, m.awayTeamId, m.homeScore, m.awayScore, week, year,
    );
    await prisma.matchup.update({ where: { id: m.id }, data: { winnerId } });
    console.log(`[finalize] matchup ${m.id} → winner ${winnerId ?? 'tie'}`);

    // Update team stats: both teams accumulate pointsFor; winner/loser get wins/losses.
    await prisma.team.update({ where: { id: m.homeTeamId }, data: { pointsFor: { increment: m.homeScore } } });
    await prisma.team.update({ where: { id: m.awayTeamId }, data: { pointsFor: { increment: m.awayScore } } });
    if (winnerId !== null) {
      const loserId = winnerId === m.homeTeamId ? m.awayTeamId : m.homeTeamId;
      await prisma.team.update({ where: { id: winnerId }, data: { wins: { increment: 1 } } });
      await prisma.team.update({ where: { id: loserId }, data: { losses: { increment: 1 } } });
    }
  }

  const nextWeek = Math.min(week + 1, 10);
  await prisma.league.update({ where: { id: leagueId }, data: { currentWeek: nextWeek } });
  console.log(`[finalize] league ${leagueId} week ${week} → ${nextWeek}`);
}

async function main(): Promise<void> {
  // Single-source week boundary: same Pacific Tue function used by dailyPipeline.
  // At Mon 0:01 AM Pacific (finalize cron time), this returns last Tuesday = week just ended.
  const weekDate = getCurrentWeekDate();
  console.log(`[finalize] week boundary ${weekDate.toISOString().slice(0, 10)} (Tue 0:00 Pacific start)`);

  const leagues = await prisma.league.findMany({
    where: { status: 'active' },
    select: { id: true, currentWeek: true, seasonYear: true },
  });

  for (const { id: leagueId, currentWeek: week, seasonYear: year } of leagues) {
    await finalizeLeagueWeek(leagueId, week, year);
  }

  console.log('[finalize] done');
}

main()
  .catch((err) => { console.error('[finalize] fatal:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
