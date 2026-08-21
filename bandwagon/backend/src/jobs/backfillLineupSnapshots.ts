/**
 * One-off repair: give past weeks a lineup of record.
 *
 * `LineupSnapshot` only started being written partway through the 2026 season,
 * so the weeks played before it shipped have no frozen lineup. The matchup
 * routes fall back to the live roster for those weeks (applyLineupSnapshot),
 * which means opening a finished game shows TODAY's roster — players who
 * weren't on the team that week, under a final score they never produced.
 *
 * Only league week 1 is recoverable, and only sometimes. `DraftPick` records
 * the artist AND the slot every team started with, so when nothing moved on any
 * roster before that week closed, the drafted lineup provably IS the week-1
 * lineup. Later weeks have no comparable record — an add/drop overwrites the
 * RosterSpot row it replaces — so they are reported and skipped rather than
 * guessed at.
 *
 * The script also audits every finalized week that does have a snapshot,
 * printing the stored matchup score beside the sum of the frozen starters, so
 * any week whose header and box score disagree is visible.
 *
 *   npx tsx src/jobs/backfillLineupSnapshots.ts            # audit only (default)
 *   npx tsx src/jobs/backfillLineupSnapshots.ts --apply    # write the snapshots
 */
import { prisma } from '../db/prisma';
import { weekDateForLeagueWeek } from '../scoring/weeks';

// Feed events written by the code paths that move an artist between rosters.
const ROSTER_MUTATING_EVENTS = ['claim', 'waiver_won', 'trade_executed', 'artist_split'];

const ptDate = (d: Date): string => d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

export interface BackfillResult {
  written: number;
  skipped: { leagueId: string; week: number; reason: string }[];
  mismatches: { leagueId: string; week: number; teamId: string; stored: number; lineup: number }[];
}

export async function backfillLineupSnapshots(apply: boolean): Promise<BackfillResult> {
  const result: BackfillResult = { written: 0, skipped: [], mismatches: [] };

  const leagues = await prisma.league.findMany({
    where: { draftTime: { not: null } },
    select: { id: true, name: true, draftTime: true, currentWeek: true },
  });

  for (const league of leagues) {
    const finalizedWeeks = await prisma.matchup.findMany({
      where: { leagueId: league.id, isFinalized: true },
      select: { week: true },
      distinct: ['week'],
      orderBy: { week: 'asc' },
    });

    for (const { week } of finalizedWeeks) {
      const weekDate = weekDateForLeagueWeek(league, week);
      const have = await prisma.lineupSnapshot.count({ where: { leagueId: league.id, week } });

      if (have > 0) {
        result.mismatches.push(...(await auditWeek(league.id, week, weekDate)));
        continue;
      }

      if (week !== 1) {
        result.skipped.push({ leagueId: league.id, week, reason: 'no lineup record exists for weeks after 1' });
        continue;
      }

      // Anything that moved an artist on or before the Sunday this week closed
      // means the drafted slots are no longer a faithful record of it.
      const weekEndPT = ptDate(addDays(weekDate, 5));
      const events = await prisma.leagueEvent.findMany({
        where: { leagueId: league.id, type: { in: ROSTER_MUTATING_EVENTS } },
        select: { createdAt: true },
      });
      const mutatedInWeek = events.some((e) => ptDate(e.createdAt) <= weekEndPT);
      if (mutatedInWeek) {
        result.skipped.push({ leagueId: league.id, week, reason: 'a roster changed before the week closed' });
        continue;
      }

      const picks = await prisma.draftPick.findMany({
        where: { leagueId: league.id },
        select: { teamId: true, slot: true, artistId: true },
      });
      if (!picks.length) {
        result.skipped.push({ leagueId: league.id, week, reason: 'no draft picks recorded' });
        continue;
      }

      console.log(`[backfill] ${league.name} week ${week}: ${picks.length} spots from the draft`);
      if (apply) {
        // skipDuplicates keeps this rerunnable and can never overwrite a real
        // capture, same contract as captureLineupSnapshot.
        const { count } = await prisma.lineupSnapshot.createMany({
          data: picks.map((p) => ({ leagueId: league.id, week, teamId: p.teamId, slot: p.slot, artistId: p.artistId })),
          skipDuplicates: true,
        });
        result.written += count;
      }
      result.mismatches.push(...(await auditWeek(league.id, week, weekDate, picks)));
    }
  }

  return result;
}

// Stored matchup score vs the sum of the week's frozen starters. `pending`
// stands in for snapshot rows this run would write but hasn't (dry run).
async function auditWeek(
  leagueId: string,
  week: number,
  weekDate: Date,
  pending?: { teamId: string; slot: string; artistId: string | null }[],
): Promise<BackfillResult['mismatches']> {
  const rows = pending ?? (await prisma.lineupSnapshot.findMany({
    where: { leagueId, week },
    select: { teamId: true, slot: true, artistId: true },
  }));
  const starters = rows.filter((r) => !r.slot.startsWith('Bench') && r.artistId);

  const scores = new Map<string, number>();
  for (const artistId of new Set(starters.map((s) => s.artistId!))) {
    const ws = await prisma.weeklyScore.findUnique({
      where: { artistId_weekDate: { artistId, weekDate } },
      select: { totalPoints: true },
    });
    scores.set(artistId, ws?.totalPoints ?? 0);
  }

  const lineupTotal = new Map<string, number>();
  for (const s of starters) {
    lineupTotal.set(s.teamId, (lineupTotal.get(s.teamId) ?? 0) + (scores.get(s.artistId!) ?? 0));
  }

  const matchups = await prisma.matchup.findMany({
    where: { leagueId, week },
    select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });
  const out: BackfillResult['mismatches'] = [];
  for (const m of matchups) {
    for (const [teamId, stored] of [[m.homeTeamId, m.homeScore], [m.awayTeamId, m.awayScore]] as const) {
      const lineup = lineupTotal.get(teamId);
      if (lineup !== undefined && Math.abs(lineup - stored) > 0.001) {
        out.push({ leagueId, week, teamId, stored, lineup });
      }
    }
  }
  return out;
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  backfillLineupSnapshots(apply)
    .then((r) => {
      console.log(`\n[backfill] ${apply ? `wrote ${r.written} snapshot rows` : 'dry run — nothing written'}`);
      for (const s of r.skipped) console.log(`[backfill] skipped league ${s.leagueId} week ${s.week}: ${s.reason}`);
      if (r.mismatches.length) {
        console.log(`\n[backfill] ${r.mismatches.length} team-week(s) where the final score does not equal its frozen lineup:`);
        for (const m of r.mismatches) {
          console.log(`  league ${m.leagueId} week ${m.week} team ${m.teamId}: stored ${m.stored} vs lineup ${m.lineup}`);
        }
      } else {
        console.log('[backfill] every audited week: final score equals its frozen lineup');
      }
      if (!apply) console.log('\n[backfill] dry run — pass --apply to write');
    })
    .catch((err) => { console.error('[backfill] fatal:', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
