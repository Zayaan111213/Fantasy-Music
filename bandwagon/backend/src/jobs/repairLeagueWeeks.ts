import { prisma } from '../db/prisma';
import { getCurrentWeekDate } from './ingestCharts';
import { scoreAllArtistsForWeek, updateMatchupScores } from '../scoring/engine';
import { logLeagueEvent } from '../events/leagueEvents';

// One-off admin repair for the 2026-07-13 week-skipping incident (finalize
// re-fired on every Monday deploy and advanced leagues several weeks in one
// day). For each league given a corrected week, this:
//   - un-finalizes matchups from the phantom weeks (isFinalized/winnerId/
//     scores reset; the round-robin schedule rows themselves are kept)
//   - recomputes team wins/losses/pointsFor from the surviving finalized
//     regular-season matchups
//   - deletes the phantom "Week N final" feed events
//   - rolls league.currentWeek back and clears lastFinalizedDatePT
// Then, for all leagues, rebuilds the WeeklyScore cache (wiped by the
// weekly_score_by_week_date migration) by scoring every artist against every
// real chart week, and refreshes current matchup totals.
//
// Usage:
//   DATABASE_URL=<url> npx tsx src/jobs/repairLeagueWeeks.ts \
//     --set CHART-2026=4 --set <inviteCodeOrLeagueId>=2 [--dry-run]

interface Correction {
  key: string; // invite code or league id
  trueWeek: number;
}

function parseArgs(argv: string[]): { corrections: Correction[]; dryRun: boolean } {
  const corrections: Correction[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--set') {
      const [key, weekStr] = (argv[i + 1] ?? '').split('=');
      const trueWeek = parseInt(weekStr, 10);
      if (!key || isNaN(trueWeek) || trueWeek < 1) {
        throw new Error(`Invalid --set argument: ${argv[i + 1]}`);
      }
      corrections.push({ key, trueWeek });
      i++;
    }
  }
  return { corrections, dryRun: argv.includes('--dry-run') };
}

export async function repairLeagueWeeks(corrections: Correction[], dryRun: boolean): Promise<void> {
  const label = dryRun ? '[repair:dry-run]' : '[repair]';

  for (const { key, trueWeek } of corrections) {
    const league = await prisma.league.findFirst({
      where: { OR: [{ inviteCode: key }, { id: key }] },
      include: { teams: { select: { id: true, name: true } } },
    });
    if (!league) { console.error(`${label} league "${key}" not found — skipping`); continue; }
    if (league.currentWeek <= trueWeek) {
      console.log(`${label} ${league.name}: currentWeek ${league.currentWeek} <= target ${trueWeek} — nothing to roll back`);
      continue;
    }

    console.log(`${label} ${league.name}: week ${league.currentWeek} → ${trueWeek}`);

    const phantom = await prisma.matchup.findMany({
      where: { leagueId: league.id, week: { gte: trueWeek }, isFinalized: true },
      select: { id: true, week: true, matchupType: true },
    });
    console.log(`${label}   un-finalizing ${phantom.length} phantom matchup(s) in weeks >= ${trueWeek}`);

    const events = await prisma.leagueEvent.findMany({
      where: { leagueId: league.id, type: 'week_result' },
      select: { id: true, message: true },
    });
    const bogusEvents = events.filter((e) => {
      const m = /^Week (\d+) final:/.exec(e.message);
      return m !== null && parseInt(m[1], 10) >= trueWeek;
    });
    console.log(`${label}   deleting ${bogusEvents.length} phantom week-result feed event(s)`);

    if (dryRun) continue;

    await prisma.matchup.updateMany({
      where: { leagueId: league.id, week: { gte: trueWeek } },
      data: { isFinalized: false, winnerId: null, homeScore: 0, awayScore: 0 },
    });
    if (bogusEvents.length) {
      await prisma.leagueEvent.deleteMany({ where: { id: { in: bogusEvents.map((e) => e.id) } } });
    }

    // Standings from scratch: only the surviving finalized regular matchups count.
    const finalized = await prisma.matchup.findMany({
      where: { leagueId: league.id, week: { lt: trueWeek }, isFinalized: true, matchupType: 'regular' },
    });
    const stats = new Map(league.teams.map((t) => [t.id, { wins: 0, losses: 0, pointsFor: 0 }]));
    for (const m of finalized) {
      const home = stats.get(m.homeTeamId);
      const away = stats.get(m.awayTeamId);
      if (home) home.pointsFor += m.homeScore;
      if (away) away.pointsFor += m.awayScore;
      if (m.winnerId) {
        const loserId = m.winnerId === m.homeTeamId ? m.awayTeamId : m.homeTeamId;
        const winner = stats.get(m.winnerId);
        const loser = stats.get(loserId);
        if (winner) winner.wins += 1;
        if (loser) loser.losses += 1;
      }
    }
    for (const [teamId, s] of stats) {
      await prisma.team.update({ where: { id: teamId }, data: s });
    }

    await prisma.league.update({
      where: { id: league.id },
      data: { currentWeek: trueWeek, lastFinalizedDatePT: null },
    });
    await logLeagueEvent(
      prisma,
      league.id,
      'week_repair',
      `Scoreboard fixed: a scheduling bug advanced this league several weeks in one day. The season is back at week ${trueWeek}, standings recomputed from the real results.`,
    );
    console.log(`${label}   ${league.name} repaired — standings recomputed from ${finalized.length} real matchup(s)`);
  }

  // Rebuild the WeeklyScore cache for every real chart week, then refresh
  // current matchup totals for all active leagues.
  const chartWeeks = await prisma.chartEntry.findMany({
    select: { weekDate: true },
    distinct: ['weekDate'],
    orderBy: { weekDate: 'asc' },
  });
  if (dryRun) {
    console.log(`${label} would rebuild scores for ${chartWeeks.length} chart week(s) and refresh matchups`);
    return;
  }
  for (const { weekDate } of chartWeeks) {
    await scoreAllArtistsForWeek(weekDate);
  }
  const active = await prisma.league.findMany({
    where: { status: 'active' },
    select: { id: true, currentWeek: true },
  });
  const currentWeekDate = getCurrentWeekDate();
  for (const l of active) {
    await updateMatchupScores(l.id, l.currentWeek, currentWeekDate);
  }
  console.log(`${label} rebuilt ${chartWeeks.length} chart week(s) of scores; matchups refreshed for ${active.length} league(s)`);
}

if (require.main === module) {
  const { corrections, dryRun } = parseArgs(process.argv.slice(2));
  repairLeagueWeeks(corrections, dryRun)
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error('Fatal:', err);
      prisma.$disconnect().finally(() => process.exit(1));
    });
}
