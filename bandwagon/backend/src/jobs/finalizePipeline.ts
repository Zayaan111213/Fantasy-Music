import { prisma } from '../db/prisma';
import { getCurrentWeekDate } from './ingestCharts';
import {
  ensurePlayoffMatchups,
  PLAYOFF_FINALS_WEEK,
  PLAYOFF_SEMIS_WEEK,
  REGULAR_SEASON_WEEKS,
} from '../playoffs/bracket';
import { runTradeFinalizeSteps } from '../trades/engine';

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
    // A previous run may have crashed after the isFinalized flip but before the
    // trade/bracket/advance steps — re-run them (all idempotent) so the league
    // can't get stranded mid-boundary.
    await runTradeFinalizeSteps(leagueId, week);
    if (week >= REGULAR_SEASON_WEEKS) await advanceSeason(leagueId, week);
    return;
  }

  // winnerId varies per matchup so loop after the bulk isFinalized flip.
  // Scores are frozen at this point; same inputs → same winner on any retry of this block.
  const matchups = await prisma.matchup.findMany({ where: { leagueId, week } });
  for (const m of matchups) {
    let winnerId = await resolveWinner(
      m.homeTeamId, m.awayTeamId, m.homeScore, m.awayScore, week, year,
    );
    // Playoff games can't end in a tie: the better (lower-number) seed advances.
    if (winnerId === null && m.matchupType !== 'regular' && m.homeSeed != null && m.awaySeed != null) {
      winnerId = m.homeSeed < m.awaySeed ? m.homeTeamId : m.awayTeamId;
    }
    await prisma.matchup.update({ where: { id: m.id }, data: { winnerId } });
    console.log(`[finalize] matchup ${m.id} → winner ${winnerId ?? 'tie'}`);

    // Update team stats: both teams accumulate pointsFor; winner/loser get wins/losses.
    // Playoff games don't count — standings freeze as the regular-season record.
    if (m.matchupType === 'regular') {
      await prisma.team.update({ where: { id: m.homeTeamId }, data: { pointsFor: { increment: m.homeScore } } });
      await prisma.team.update({ where: { id: m.awayTeamId }, data: { pointsFor: { increment: m.awayScore } } });
      if (winnerId !== null) {
        const loserId = winnerId === m.homeTeamId ? m.awayTeamId : m.homeTeamId;
        await prisma.team.update({ where: { id: winnerId }, data: { wins: { increment: 1 } } });
        await prisma.team.update({ where: { id: loserId }, data: { losses: { increment: 1 } } });
      }
    }
  }

  // End of the scoring week: execute accepted trades (and cancel stale
  // proposals once the trade deadline passes) before the week advances.
  await runTradeFinalizeSteps(leagueId, week);

  await advanceSeason(leagueId, week);
}

// After a week finalizes: create the next playoff round when due, then advance
// currentWeek, or mark the season complete after the finals week. Idempotent —
// the currentWeek update is monotonic and bracket creation no-ops when the
// next week's matchups already exist.
async function advanceSeason(leagueId: string, week: number): Promise<void> {
  if (week >= PLAYOFF_FINALS_WEEK) {
    const { count } = await prisma.league.updateMany({
      where: { id: leagueId, status: { not: 'complete' } },
      data: { status: 'complete' },
    });
    if (count > 0) console.log(`[finalize] league ${leagueId} — season complete`);
    return;
  }

  if (week === REGULAR_SEASON_WEEKS || week === PLAYOFF_SEMIS_WEEK) {
    await ensurePlayoffMatchups(leagueId, week);
  }

  // Advance only if next week's matchups exist: a league too small for playoffs
  // has none after week 10 (ensurePlayoffMatchups already marked it complete).
  const next = await prisma.matchup.findFirst({
    where: { leagueId, week: week + 1 },
    select: { id: true },
  });
  if (next) {
    await prisma.league.updateMany({
      where: { id: leagueId, currentWeek: { lt: week + 1 } },
      data: { currentWeek: week + 1 },
    });
    console.log(`[finalize] league ${leagueId} week ${week} → ${week + 1}`);
  }
}

// Returns the PT calendar date (YYYY-MM-DD) of the first scoring Tuesday after the draft.
// Matches the same logic used by isLineupLocked() in leagues.ts.
export function firstScoringTuesdayPT(draftTime: Date): string {
  const dowNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const draftDow = dowNames.indexOf(
    draftTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' }),
  );
  // If draft is on Tuesday, next scoring Tuesday is 7 days later (week-1 exception).
  const daysToTuesday = draftDow === 2 ? 7 : (2 - draftDow + 7) % 7;
  const firstTuesday = new Date(draftTime);
  firstTuesday.setDate(draftTime.getDate() + daysToTuesday);
  return firstTuesday.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

export async function runFinalizePipeline(): Promise<void> {
  // Single-source week boundary: same Pacific Tue function used by dailyPipeline.
  // At Mon 0:01 AM Pacific (finalize cron time), this returns last Tuesday = week just ended.
  const weekDate = getCurrentWeekDate();
  const todayPT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  console.log(`[finalize] week boundary ${weekDate.toISOString().slice(0, 10)}, today PT: ${todayPT}`);

  const leagues = await prisma.league.findMany({
    where: { status: 'active' },
    select: { id: true, currentWeek: true, seasonYear: true, draftTime: true },
  });

  for (const { id: leagueId, currentWeek: week, seasonYear: year, draftTime } of leagues) {
    // Week 1 exception: there is no game in the gap between draft completion and the
    // first scoring Tuesday. Only finalize once the Monday AFTER the first full scoring
    // week (Tue–Sun) has been reached — i.e. firstScoringTuesday + 6 days.
    if (week === 1 && draftTime) {
      const firstTuesdayStr = firstScoringTuesdayPT(draftTime);
      const firstTuesdayDate = new Date(firstTuesdayStr + 'T12:00:00Z');
      const firstMonday = new Date(firstTuesdayDate);
      firstMonday.setUTCDate(firstTuesdayDate.getUTCDate() + 6);
      const firstMondayStr = firstMonday.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      if (todayPT < firstMondayStr) {
        console.log(
          `[finalize] league ${leagueId} week 1 — first scoring week starts ${firstTuesdayStr},` +
          ` first finalize on ${firstMondayStr}, skipping (today ${todayPT})`,
        );
        continue;
      }
    }

    await finalizeLeagueWeek(leagueId, week, year);
  }

  console.log('[finalize] done');
}

if (require.main === module) {
  runFinalizePipeline()
    .catch((err) => { console.error('[finalize] fatal:', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
