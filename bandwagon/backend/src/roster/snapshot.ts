import { prisma } from '../db/prisma';
import { weekDateForLeagueWeek, type LeagueWeekAnchor } from '../scoring/weeks';

type Db = Pick<typeof prisma, 'lineupSnapshot' | 'rosterSpot'>;

// Freezes every team's current roster as the lineup of record for `week`.
//
// Only ever called while the lineup is locked, so "current roster" IS the
// lineup that played that week. `skipDuplicates` makes it idempotent: the
// first capture of a week wins and later calls (a second daily-pipeline run,
// the finalize fallback) are no-ops, so a snapshot can never be rewritten by a
// roster change that happened after the week it describes.
export async function captureLineupSnapshot(
  db: Db,
  leagueId: string,
  week: number,
): Promise<number> {
  const spots = await db.rosterSpot.findMany({
    where: { team: { leagueId } },
    select: { teamId: true, slot: true, artistId: true },
  });
  if (!spots.length) return 0;

  const { count } = await db.lineupSnapshot.createMany({
    data: spots.map((s) => ({ leagueId, week, teamId: s.teamId, slot: s.slot, artistId: s.artistId })),
    skipDuplicates: true,
  });
  return count;
}

// Shape-compatible with the `rosterSpots` include the matchup routes return,
// so the frontend renders a snapshot exactly like a live roster.
export interface SnapshotSpot {
  id: string;
  teamId: string;
  slot: string;
  artistId: string | null;
  artist: unknown | null;
}

// Returns the frozen lineups for `week`, keyed by teamId — or null when the
// week predates snapshotting, in which case callers keep their live
// RosterSpot include (the pre-existing behavior).
export async function getLineupSnapshot(
  league: LeagueWeekAnchor & { id: string },
  week: number,
  teamIds: string[],
): Promise<Map<string, SnapshotSpot[]> | null> {
  const rows = await prisma.lineupSnapshot.findMany({
    where: { leagueId: league.id, week, teamId: { in: teamIds } },
    include: {
      artist: {
        include: {
          weeklyScores: { where: { weekDate: weekDateForLeagueWeek(league, week) } },
        },
      },
    },
  });
  if (!rows.length) return null;

  const byTeam = new Map<string, SnapshotSpot[]>();
  for (const r of rows) {
    const list = byTeam.get(r.teamId) ?? [];
    list.push({ id: r.id, teamId: r.teamId, slot: r.slot, artistId: r.artistId, artist: r.artist });
    byTeam.set(r.teamId, list);
  }
  return byTeam;
}

// Overlays frozen lineups onto a matchup's two teams in place. No-ops when the
// week has no snapshot, leaving the live rosters the query already loaded.
export async function applyLineupSnapshot<
  T extends {
    week: number;
    homeTeamId: string;
    awayTeamId: string;
    homeTeam: { rosterSpots: unknown[] };
    awayTeam: { rosterSpots: unknown[] };
  },
>(matchup: T, league: LeagueWeekAnchor & { id: string }): Promise<T> {
  const byTeam = await getLineupSnapshot(league, matchup.week, [matchup.homeTeamId, matchup.awayTeamId]);
  if (!byTeam) return matchup;

  const home = byTeam.get(matchup.homeTeamId);
  const away = byTeam.get(matchup.awayTeamId);
  if (home) matchup.homeTeam.rosterSpots = home;
  if (away) matchup.awayTeam.rosterSpots = away;
  return matchup;
}
