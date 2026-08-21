/**
 * One-off repair: finish a week that was finalized but never scored out.
 *
 * `finalizeLeagueWeek()` flips `isFinalized` in one atomic updateMany and then
 * loops the week's matchups to set `winnerId`, log the `week_result` feed event,
 * and credit wins/losses/pointsFor. When two finalize runners overlap, one flips
 * the flag and dies, and the other arrives to `count === 0` and takes the
 * crash-recovery path — which re-runs trades, waivers and advanceSeason but NOT
 * that loop. The week ends up marked final with no winner and no standings
 * credit (incident of 2026-08-17: week 2 in both live leagues, week 10 in the
 * demo league).
 *
 * A week needs repair when it has a finalized matchup with no `winnerId` AND no
 * `week_result` event. Both conditions are required and together they are exact:
 * the event and the record credit are written in the same loop, so its absence
 * proves the loop never ran, while a legitimate tie leaves `winnerId` null on a
 * week that DOES have its event. Seeded demo weeks that were written with
 * winners already are skipped by the first condition, so nothing is
 * double-counted.
 *
 *   npx tsx src/jobs/repairUncreditedWeeks.ts            # dry run (default)
 *   npx tsx src/jobs/repairUncreditedWeeks.ts --apply
 */
import { prisma } from '../db/prisma';
import { weekDateForLeagueWeek } from '../scoring/weeks';
import { resolveWinner } from './finalizePipeline';
import { logLeagueEvent } from '../events/leagueEvents';

export interface WeekRepair {
  leagueId: string;
  leagueName: string;
  week: number;
  results: { matchupId: string; home: string; away: string; homeScore: number; awayScore: number; winner: string }[];
}

export async function repairUncreditedWeeks(apply: boolean): Promise<WeekRepair[]> {
  const repairs: WeekRepair[] = [];

  // No draftTime filter: a league seeded without a draft (the demo league) can
  // still have a week stranded this way, and weekDateForLeagueWeek() already
  // falls back for a missing schedule. The weekDate only feeds the tiebreaker,
  // which a week with decisive scores never reaches.
  const leagues = await prisma.league.findMany({
    select: { id: true, name: true, draftTime: true, currentWeek: true },
  });

  for (const league of leagues) {
    const weeks = await prisma.matchup.findMany({
      where: { leagueId: league.id, isFinalized: true },
      select: { week: true },
      distinct: ['week'],
      orderBy: { week: 'asc' },
    });

    for (const { week } of weeks) {
      const matchups = await prisma.matchup.findMany({ where: { leagueId: league.id, week, isFinalized: true } });
      if (!matchups.some((m) => m.winnerId === null)) continue;

      // "Week 1 final:" must not match "Week 10 final:", hence the trailing space.
      const recap = await prisma.leagueEvent.findFirst({
        where: { leagueId: league.id, type: 'week_result', message: { startsWith: `Week ${week} final: ` } },
        select: { id: true },
      });
      if (recap) continue; // the loop ran; a null winner here is a real tie

      const teams = await prisma.team.findMany({ where: { leagueId: league.id }, select: { id: true, name: true } });
      const teamName = new Map(teams.map((t) => [t.id, t.name]));
      const weekDate = weekDateForLeagueWeek(league, week);
      const repair: WeekRepair = { leagueId: league.id, leagueName: league.name, week, results: [] };

      for (const m of matchups) {
        let winnerId = await resolveWinner(
          m.homeTeamId, m.awayTeamId, m.homeScore, m.awayScore, weekDate, { leagueId: league.id, week },
        );
        if (winnerId === null && m.matchupType !== 'regular' && m.homeSeed != null && m.awaySeed != null) {
          winnerId = m.homeSeed < m.awaySeed ? m.homeTeamId : m.awayTeamId;
        }

        const home = teamName.get(m.homeTeamId) ?? 'Home team';
        const away = teamName.get(m.awayTeamId) ?? 'Away team';
        const outcome = winnerId === null ? 'Tie' : `${teamName.get(winnerId) ?? 'Winner'} wins`;
        repair.results.push({
          matchupId: m.id, home, away, homeScore: m.homeScore, awayScore: m.awayScore, winner: outcome,
        });

        if (!apply) continue;

        await prisma.matchup.update({ where: { id: m.id }, data: { winnerId } });
        await logLeagueEvent(
          prisma,
          league.id,
          'week_result',
          `Week ${week} final: ${home} ${m.homeScore} - ${away} ${m.awayScore} · ${outcome}`,
        );
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

      repairs.push(repair);
    }
  }

  return repairs;
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  repairUncreditedWeeks(apply)
    .then((repairs) => {
      if (!repairs.length) {
        console.log('[repair] no finalized week is missing its winners');
        return;
      }
      for (const r of repairs) {
        console.log(`\n[repair] ${r.leagueName} week ${r.week}${apply ? '' : ' (would fix)'}:`);
        for (const g of r.results) {
          console.log(`  ${g.home} ${g.homeScore} - ${g.away} ${g.awayScore} · ${g.winner}`);
        }
      }
      if (!apply) console.log('\n[repair] dry run — pass --apply to write');
    })
    .catch((err) => { console.error('[repair] fatal:', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
