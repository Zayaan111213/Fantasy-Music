import { prisma } from '../db/prisma';
import { getCurrentWeekDate } from './ingestCharts';
import { firstScoringTuesdayPT, weekDateForLeagueWeek } from '../scoring/weeks';
import { captureLineupSnapshot } from '../roster/snapshot';
export { firstScoringTuesdayPT };
import {
  ensurePlayoffMatchups,
  PLAYOFF_FINALS_WEEK,
  PLAYOFF_SEMIS_WEEK,
  REGULAR_SEASON_WEEKS,
} from '../playoffs/bracket';
import { runTradeFinalizeSteps } from '../trades/engine';
import { resolveWaivers } from '../waivers/engine';
import { logLeagueEvent } from '../events/leagueEvents';

export async function bestArtistScore(teamId: string, weekDate: Date): Promise<number> {
  const spots = await prisma.rosterSpot.findMany({
    where: { teamId, slot: { not: { startsWith: 'Bench' } }, artistId: { not: null } },
    select: { artistId: true },
  });
  const scores = await Promise.all(
    spots.map(({ artistId }) =>
      prisma.weeklyScore.findUnique({
        where: { artistId_weekDate: { artistId: artistId!, weekDate } },
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
  weekDate: Date,
): Promise<string | null> {
  if (homeScore !== awayScore) {
    return homeScore > awayScore ? homeTeamId : awayTeamId;
  }
  // Tiebreaker: highest single artist score among starters
  const [homeBest, awayBest] = await Promise.all([
    bestArtistScore(homeTeamId, weekDate),
    bestArtistScore(awayTeamId, weekDate),
  ]);
  if (homeBest !== awayBest) return homeBest > awayBest ? homeTeamId : awayTeamId;
  return null; // true tie
}

// weekDate = the calendar chart week whose scores settle this league week.
// Defaults to the week that just ended (finalize runs Monday); test helpers
// simulating multi-week seasons rely on the default too.
export async function finalizeLeagueWeek(
  leagueId: string,
  week: number,
  weekDate: Date = getCurrentWeekDate(),
): Promise<void> {
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
    //
    // advanceSeason MUST run for every week, not just week >= REGULAR_SEASON_WEEKS.
    // Gating it stranded three production leagues (incident of 2026-08-17): two
    // finalize runners overlap (the in-process scheduler and the finalize cron
    // service), one flips isFinalized and then dies in the trade/waiver steps,
    // the other arrives to count === 0 and returns without ever advancing
    // currentWeek — and because it returns *successfully* it stamps
    // lastFinalizedDatePT, so the guard skips every later attempt. The league
    // then sits on that week forever, re-scoring one fixed chart week while the
    // charts move on. advanceSeason is monotonic (currentWeek: { lt: week + 1 })
    // and bracket creation no-ops when next week's matchups exist, so calling it
    // unconditionally is safe.
    await runTradeFinalizeSteps(leagueId, week);
    await resolveWaivers(leagueId);
    await advanceSeason(leagueId, week);
    return;
  }

  // Fallback lineup freeze, for a week the daily pipeline never got to capture
  // (it normally freezes on the first locked day). Must run BEFORE the trade and
  // waiver steps below, which mutate rosters — and it's write-once, so a week
  // the daily pipeline already froze is untouched.
  await captureLineupSnapshot(prisma, leagueId, week);

  // winnerId varies per matchup so loop after the bulk isFinalized flip.
  // Scores are frozen at this point; same inputs → same winner on any retry of this block.
  const teams = await prisma.team.findMany({
    where: { leagueId },
    select: { id: true, name: true },
  });
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const matchups = await prisma.matchup.findMany({ where: { leagueId, week } });
  for (const m of matchups) {
    let winnerId = await resolveWinner(
      m.homeTeamId, m.awayTeamId, m.homeScore, m.awayScore, weekDate,
    );
    // Playoff games can't end in a tie: the better (lower-number) seed advances.
    if (winnerId === null && m.matchupType !== 'regular' && m.homeSeed != null && m.awaySeed != null) {
      winnerId = m.homeSeed < m.awaySeed ? m.homeTeamId : m.awayTeamId;
    }
    await prisma.matchup.update({ where: { id: m.id }, data: { winnerId } });
    console.log(`[finalize] matchup ${m.id} → winner ${winnerId ?? 'tie'}`);

    // Feed recap — only reachable inside the count>0 gate, so idempotent
    // re-runs never duplicate events.
    const home = teamName.get(m.homeTeamId) ?? 'Home team';
    const away = teamName.get(m.awayTeamId) ?? 'Away team';
    const outcome = winnerId === null ? 'Tie' : `${teamName.get(winnerId) ?? 'Winner'} wins`;
    await logLeagueEvent(
      prisma,
      leagueId,
      'week_result',
      `Week ${week} final: ${home} ${m.homeScore} - ${away} ${m.awayScore} · ${outcome}`,
    );

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
  // proposals once the trade deadline passes) before the week advances,
  // then resolve waiver claims — trades first, so traded artists naturally
  // invalidate stale claims.
  await runTradeFinalizeSteps(leagueId, week);
  await resolveWaivers(leagueId);

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
    if (count > 0) {
      console.log(`[finalize] league ${leagueId} — season complete`);
      const finals = await prisma.matchup.findFirst({
        where: { leagueId, week: PLAYOFF_FINALS_WEEK, matchupType: 'championship' },
        select: { winnerId: true },
      });
      const champion = finals?.winnerId
        ? await prisma.team.findUnique({ where: { id: finals.winnerId }, select: { name: true } })
        : null;
      await logLeagueEvent(
        prisma,
        leagueId,
        'season_complete',
        champion
          ? `🏆 ${champion.name} wins the championship! The season is complete.`
          : 'The season is complete.',
      );
    }
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
    const { count: advanced } = await prisma.league.updateMany({
      where: { id: leagueId, currentWeek: { lt: week + 1 } },
      data: { currentWeek: week + 1 },
    });
    console.log(`[finalize] league ${leagueId} week ${week} → ${week + 1}`);
    // Guarded by the monotonic currentWeek update so crash-recovery re-runs
    // (count=0 outer gate) never send duplicate reminders.
    if (advanced > 0) {
      const members = await prisma.team.findMany({
        where: { leagueId },
        select: { userId: true },
      });
      if (members.length > 0) {
        await prisma.notification.createMany({
          data: members.map((t) => ({
            userId: t.userId,
            leagueId,
            type: 'lineup_reminder',
            message: `Week ${week + 1} is here. Set your lineup before it locks on Tuesday!`,
          })),
        });
      }
    }
  }
}

// firstScoringTuesdayPT moved to scoring/weeks.ts (shared with the league-week →
// chart-week mapping) and is re-exported from the import block at the top of
// this file, so existing import sites — isLineupLocked() in leagues.ts, tests —
// keep working.

export async function runFinalizePipeline(options: { force?: boolean } = {}): Promise<void> {
  // Single-source week boundary: same Pacific Tue function used by dailyPipeline.
  // At Mon 0:01 AM Pacific (finalize cron time), this returns last Tuesday = week just ended.
  const weekDate = getCurrentWeekDate();
  const todayPT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  console.log(`[finalize] week boundary ${weekDate.toISOString().slice(0, 10)}, today PT: ${todayPT}`);

  const leagues = await prisma.league.findMany({
    where: { status: 'active' },
    select: { id: true, currentWeek: true, draftTime: true, lastFinalizedDatePT: true },
  });

  const failedLeagueIds: string[] = [];

  for (const { id: leagueId, currentWeek: week, draftTime, lastFinalizedDatePT } of leagues) {
    // DB-persisted once-per-PT-date guard. The scheduler's in-memory dedupe
    // resets on every restart, so each deploy on a Monday used to re-run
    // finalize against the freshly advanced currentWeek and skip whole weeks.
    // Set only after a successful run so the 15-min failure retry still works.
    if (!options.force && lastFinalizedDatePT === todayPT) {
      console.log(`[finalize] league ${leagueId} — already finalized on ${todayPT}, skipping`);
      continue;
    }
    // A league week may only be settled once its Tue–Sun scoring window has
    // actually closed, i.e. from the Monday after its chart Tuesday onwards.
    //
    // This generalizes what used to be a week-1-only gate. It has to live here
    // rather than in the caller: runFinalizePipeline is also the CLI entry
    // point (`npm run pipeline:finalize`), and the Monday-only check exists
    // only in the in-process scheduler. A daily cron running the CLI therefore
    // finalized whatever currentWeek happened to be, every single day, marching
    // a league a week ahead per day until it pointed at chart weeks that hadn't
    // happened yet (observed in production: a league on week 9 scoring against
    // 2026-09-01 while the live chart week was 2026-08-18).
    if (!options.force && draftTime) {
      const weekTuesday = weekDateForLeagueWeek({ draftTime, currentWeek: week }, week);
      const settleMonday = new Date(weekTuesday.getTime() + 6 * 24 * 60 * 60 * 1000);
      const settleMondayStr = settleMonday.toISOString().slice(0, 10);
      if (todayPT < settleMondayStr) {
        console.log(
          `[finalize] league ${leagueId} week ${week} — scoring week ${weekTuesday.toISOString().slice(0, 10)}` +
          ` closes ${settleMondayStr}, skipping (today ${todayPT})`,
        );
        continue;
      }
    }

    try {
      // Anchor on the league's own schedule rather than the global chart week.
      // They agree for a league in lockstep, but the league anchor stays correct
      // for one that drafted mid-week or had a finalize skipped — where
      // getCurrentWeekDate() would settle the week against the wrong charts.
      await finalizeLeagueWeek(leagueId, week, weekDateForLeagueWeek({ draftTime, currentWeek: week }, week));
      await prisma.league.update({ where: { id: leagueId }, data: { lastFinalizedDatePT: todayPT } });
    } catch (err) {
      // One league's failure must not block every other league in this run —
      // keep going instead of letting the throw abort the whole loop. The
      // failure is still surfaced below (after every league got a turn) so
      // the scheduler's own 15-min retry still engages for just this league;
      // lastFinalizedDatePT stays unset for it, and the guard above skips
      // every league that already succeeded on retry.
      console.error(`[finalize] league ${leagueId} failed, continuing with remaining leagues:`, err);
      failedLeagueIds.push(leagueId);
    }
  }

  console.log('[finalize] done');
  if (failedLeagueIds.length > 0) {
    throw new Error(`[finalize] ${failedLeagueIds.length} league(s) failed: ${failedLeagueIds.join(', ')}`);
  }
}

if (require.main === module) {
  // --force bypasses the once-per-PT-date guard for deliberate manual re-runs.
  runFinalizePipeline({ force: process.argv.includes('--force') })
    .catch((err) => { console.error('[finalize] fatal:', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
