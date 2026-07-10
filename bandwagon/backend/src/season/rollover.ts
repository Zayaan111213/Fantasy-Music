import { prisma } from '../db/prisma';
import { logLeagueEvent } from '../events/leagueEvents';

// Season rollover: once a season is complete the commissioner can renew the
// league for another year. Renewal keeps the league, its members, teams
// (names/logos), and the feed history, but wipes all season data and returns
// the league to `pending` with a fresh draft time — from there the normal
// draft flow (scheduler → pre_draft → drafting → active) takes over.
//
// Next season's draft order is reverse final standings: the worst team picks
// first.

export async function renewLeague(
  leagueId: string,
  userId: string,
  draftTimeISO: string,
): Promise<{ ok: true; draftTime: string; seasonYear: number } | { error: string; status: number }> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { teams: true },
  });
  if (!league) return { error: 'League not found', status: 404 };
  if (league.commissionerId !== userId) {
    return { error: 'Only the commissioner can renew the league', status: 403 };
  }
  if (league.status !== 'complete') {
    return { error: 'The league can only be renewed after the season is complete', status: 400 };
  }

  const draftTime = new Date(draftTimeISO);
  if (Number.isNaN(draftTime.getTime())) {
    return { error: 'Invalid draft time', status: 400 };
  }
  if (draftTime.getTime() - Date.now() < 60 * 60_000) {
    return { error: 'Draft time must be at least 1 hour from now', status: 400 };
  }

  // Reverse final standings (same sort as the standings endpoint / playoff
  // seeding) — computed before the records are reset.
  const finalOrder = [...league.teams].sort(
    (a, b) =>
      b.wins - a.wins ||
      b.pointsFor - a.pointsFor ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const newSeasonYear = league.seasonYear + 1;

  await prisma.$transaction(async (tx) => {
    await tx.matchup.deleteMany({ where: { leagueId } });
    await tx.draftPick.deleteMany({ where: { leagueId } });
    await tx.draftState.deleteMany({ where: { leagueId } });
    await tx.waiverClaim.deleteMany({ where: { leagueId } });
    await tx.trade.deleteMany({ where: { leagueId } }); // cascades items + vetoes
    await tx.rosterSpot.updateMany({
      where: { team: { leagueId } },
      data: { artistId: null },
    });

    // Worst team drafts first; waiver order gets re-seeded at draft completion
    // but is reset here too so the pending-state standings look sane.
    for (let i = 0; i < finalOrder.length; i++) {
      const position = finalOrder.length - i;
      await tx.team.update({
        where: { id: finalOrder[i].id },
        data: { wins: 0, losses: 0, pointsFor: 0, draftPosition: position, waiverPriority: position },
      });
    }

    await tx.league.update({
      where: { id: leagueId },
      data: { status: 'pending', draftTime, currentWeek: 1, seasonYear: newSeasonYear },
    });

    const draftLabel = draftTime.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    await logLeagueEvent(
      tx,
      leagueId,
      'league_renewed',
      `The league has been renewed for ${newSeasonYear}! Draft scheduled for ${draftLabel} PT — worst team picks first.`,
    );
    await tx.notification.createMany({
      data: league.teams.map((t) => ({
        userId: t.userId,
        leagueId,
        type: 'league_renewed',
        message: `${league.name} is back for ${newSeasonYear} — the draft is scheduled for ${draftLabel} PT.`,
      })),
    });
  });

  console.log(`[rollover] league ${leagueId} renewed for ${newSeasonYear}, draft at ${draftTime.toISOString()}`);
  return { ok: true, draftTime: draftTime.toISOString(), seasonYear: newSeasonYear };
}
