import { prisma } from '../db/prisma';
// Call-time imports only (same circularity-safe pattern as trades/engine.ts).
import { artistEligibleForSlot, isLineupLocked } from '../api/routes/leagues';
import { lockedArtistIds } from '../trades/engine';
import { logLeagueEvent } from '../events/leagueEvents';

// Waiver claims queue during the week and resolve at the weekly finalize
// (Monday ~00:01 PT = end of the Sunday scoring day), after accepted trades
// execute. Conflicts on the same artist go to the team with the better
// (lower) waiverPriority; each winner drops to the bottom of the order
// before the next conflict is decided.
//
// Exception — free agency: while the lineup is adjustable (Monday, or the
// week-1 pre-game window — the same isLineupLocked rule the lineup uses),
// pickups execute instantly and cost nothing: no queue, no waiver-order
// demotion.

export type WaiverClaimResult =
  | { claim: { id: string; artistId: string; dropSlot: string; status: string } }
  | { success: true; instant: true; slot: string; droppedArtistId: string; addedArtistId: string }
  | { error: string; status: number };

export async function submitWaiverClaim(
  leagueId: string,
  userId: string,
  artistId: string,
  dropSlot: string,
  dayPT: string,
  todayPT: string,
): Promise<WaiverClaimResult> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { teams: true },
  });
  if (!league) return { error: 'League not found', status: 404 };

  const myTeam = league.teams.find((t) => t.userId === userId);
  if (!myTeam) return { error: 'You are not in this league', status: 403 };

  if (league.status !== 'active') {
    return { error: 'Waiver claims are only available during the active season', status: 400 };
  }

  const artist = await prisma.artist.findUnique({ where: { id: artistId } });
  if (!artist || artist.hiddenAt) return { error: 'Artist not found', status: 404 };

  const rostered = await prisma.rosterSpot.findFirst({
    where: { artistId, team: { leagueId } },
  });
  if (rostered) return { error: `${artist.name} is already on a roster`, status: 400 };

  const dropSpot = await prisma.rosterSpot.findUnique({
    where: { teamId_slot: { teamId: myTeam.id, slot: dropSlot } },
    include: { artist: true },
  });
  if (!dropSpot) return { error: 'Invalid slot', status: 400 };
  if (!dropSpot.artistId) return { error: 'That slot is already empty', status: 400 };
  const locked = await lockedArtistIds(leagueId);
  if (locked.has(dropSpot.artistId)) {
    return { error: `${dropSpot.artist?.name ?? 'That player'} is locked in an accepted trade`, status: 400 };
  }

  if (!artistEligibleForSlot(artist.primaryGenre, dropSlot)) {
    return { error: `${artist.name} is not eligible for the ${dropSlot} slot`, status: 400 };
  }

  // Free agency: lineup-adjustable days execute the pickup immediately, with
  // no waiver-order demotion.
  if (!isLineupLocked(dayPT, league.currentWeek, league.draftTime, todayPT)) {
    const droppedArtistId = dropSpot.artistId;
    await prisma.rosterSpot.update({ where: { id: dropSpot.id }, data: { artistId } });
    await logLeagueEvent(
      prisma,
      leagueId,
      'claim',
      `${myTeam.name} added ${artist.name}, dropped ${dropSpot.artist?.name ?? 'an artist'} (free agency)`,
    );
    return { success: true, instant: true, slot: dropSlot, droppedArtistId, addedArtistId: artistId };
  }

  const duplicate = await prisma.waiverClaim.findFirst({
    where: { teamId: myTeam.id, artistId, status: 'pending' },
  });
  if (duplicate) {
    return { error: `You already have a pending claim for ${artist.name}`, status: 400 };
  }

  // New claims go to the back of the team's own queue.
  const lowest = await prisma.waiverClaim.findFirst({
    where: { teamId: myTeam.id, status: 'pending' },
    orderBy: { priority: 'desc' },
    select: { priority: true },
  });

  const claim = await prisma.waiverClaim.create({
    data: {
      leagueId,
      teamId: myTeam.id,
      artistId,
      dropSlot,
      dropArtistId: dropSpot.artistId,
      priority: (lowest?.priority ?? 0) + 1,
    },
  });

  return { claim: { id: claim.id, artistId: claim.artistId, dropSlot: claim.dropSlot, status: claim.status } };
}

// Reorder the team's own pending claims: claimIds is the full pending set in
// the desired order (index 0 = attempted first at resolution).
export async function reorderWaiverClaims(
  leagueId: string,
  userId: string,
  claimIds: string[],
): Promise<{ ok: true } | { error: string; status: number }> {
  const myTeam = await prisma.team.findFirst({ where: { leagueId, userId } });
  if (!myTeam) return { error: 'You are not in this league', status: 403 };

  const pending = await prisma.waiverClaim.findMany({
    where: { teamId: myTeam.id, status: 'pending' },
    select: { id: true },
  });
  const pendingIds = new Set(pending.map((c) => c.id));
  if (
    claimIds.length !== pendingIds.size ||
    new Set(claimIds).size !== claimIds.length ||
    !claimIds.every((id) => pendingIds.has(id))
  ) {
    return { error: 'Claim list must match your pending claims exactly', status: 400 };
  }

  await prisma.$transaction(
    claimIds.map((id, i) =>
      prisma.waiverClaim.update({ where: { id }, data: { priority: i + 1 } }),
    ),
  );
  return { ok: true };
}

export async function cancelWaiverClaim(
  leagueId: string,
  userId: string,
  claimId: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  const myTeam = await prisma.team.findFirst({ where: { leagueId, userId } });
  if (!myTeam) return { error: 'You are not in this league', status: 403 };

  const { count } = await prisma.waiverClaim.updateMany({
    where: { id: claimId, teamId: myTeam.id, status: 'pending' },
    data: { status: 'cancelled', resolvedAt: new Date() },
  });
  if (count === 0) return { error: 'No pending claim to cancel', status: 404 };
  return { ok: true };
}

// Thrown inside the win transaction to roll back the pending→won flip;
// the catch block then records the claim as invalid.
class WaiverInvalidError extends Error {}

export async function resolveWaivers(leagueId: string): Promise<void> {
  const claims = await prisma.waiverClaim.findMany({
    where: { leagueId, status: 'pending' },
    include: {
      team: { select: { id: true, name: true, userId: true, waiverPriority: true, createdAt: true } },
      artist: { select: { id: true, name: true, primaryGenre: true } },
    },
    // Per-team user-set priority first; createdAt breaks ties (legacy rows
    // predating the priority column all default to 0).
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
  if (claims.length === 0) return;

  // Current waiver order (index 0 = first pick). createdAt tiebreak covers
  // legacy priority ties; the first win rewrites a dense 1..N order.
  const teams = await prisma.team.findMany({
    where: { leagueId },
    select: { id: true },
    orderBy: [{ waiverPriority: 'asc' }, { createdAt: 'asc' }],
  });
  const order = teams.map((t) => t.id);

  const dropArtists = await prisma.artist.findMany({
    where: { id: { in: [...new Set(claims.map((c) => c.dropArtistId))] } },
    select: { id: true, name: true },
  });
  const dropName = new Map(dropArtists.map((a) => [a.id, a.name]));

  let remaining = [...claims];
  while (remaining.length > 0) {
    // Stable sort keeps a team's own claims in createdAt order.
    remaining.sort((a, b) => order.indexOf(a.teamId) - order.indexOf(b.teamId));
    const claim = remaining.shift()!;

    let won = false;
    try {
      won = await prisma.$transaction(async (tx) => {
        // Guarded flip is the claim gate: a concurrent or repeated finalize
        // run gets count=0 here and skips the claim entirely.
        const { count } = await tx.waiverClaim.updateMany({
          where: { id: claim.id, status: 'pending' },
          data: { status: 'won', resolution: null, resolvedAt: new Date() },
        });
        if (count === 0) return false;

        // Live re-validation: the roster may have changed since submission
        // (earlier waiver wins this run, executed trades, etc.).
        const nowRostered = await tx.rosterSpot.findFirst({
          where: { artistId: claim.artistId, team: { leagueId } },
        });
        if (nowRostered) throw new WaiverInvalidError(`${claim.artist.name} is no longer a free agent`);

        const spot = await tx.rosterSpot.findUnique({
          where: { teamId_slot: { teamId: claim.teamId, slot: claim.dropSlot } },
        });
        if (!spot || spot.artistId !== claim.dropArtistId) {
          throw new WaiverInvalidError('your roster changed since the claim was submitted');
        }
        if (!artistEligibleForSlot(claim.artist.primaryGenre, claim.dropSlot)) {
          throw new WaiverInvalidError(`${claim.artist.name} is not eligible for the ${claim.dropSlot} slot`);
        }

        await tx.rosterSpot.update({ where: { id: spot.id }, data: { artistId: claim.artistId } });

        // Winner drops to the bottom; persist the full dense order inside
        // this tx so a crash mid-resolution can't lose the demotion.
        const idx = order.indexOf(claim.teamId);
        if (idx !== -1) order.splice(idx, 1);
        order.push(claim.teamId);
        for (let i = 0; i < order.length; i++) {
          await tx.team.update({ where: { id: order[i] }, data: { waiverPriority: i + 1 } });
        }

        const dropped = dropName.get(claim.dropArtistId) ?? 'an artist';
        await logLeagueEvent(
          tx,
          leagueId,
          'waiver_won',
          `${claim.team.name} claimed ${claim.artist.name} off waivers, dropped ${dropped}`,
        );
        await tx.notification.createMany({
          data: [{
            userId: claim.team.userId,
            leagueId,
            type: 'waiver_result',
            message: `Your waiver claim went through: you added ${claim.artist.name} and dropped ${dropped}.`,
          }],
        });
        console.log(`[waivers] league ${leagueId} — ${claim.team.name} won ${claim.artist.name}`);
        return true;
      });
    } catch (err) {
      if (!(err instanceof WaiverInvalidError)) throw err;
      // Tx rolled back (flip reverted) — record the claim as invalid.
      const { count } = await prisma.waiverClaim.updateMany({
        where: { id: claim.id, status: 'pending' },
        data: { status: 'invalid', resolution: err.message, resolvedAt: new Date() },
      });
      if (count > 0) {
        await prisma.notification.createMany({
          data: [{
            userId: claim.team.userId,
            leagueId,
            type: 'waiver_result',
            message: `Your waiver claim for ${claim.artist.name} could not be processed: ${err.message}.`,
          }],
        });
        console.log(`[waivers] league ${leagueId} — claim for ${claim.artist.name} invalid: ${err.message}`);
      }
    }

    if (won) {
      // Everyone else who wanted this artist loses to the winner.
      const losers = remaining.filter((c) => c.artistId === claim.artistId);
      if (losers.length > 0) {
        await prisma.waiverClaim.updateMany({
          where: { id: { in: losers.map((c) => c.id) }, status: 'pending' },
          data: {
            status: 'lost',
            resolution: `Lost to ${claim.team.name} — higher waiver priority`,
            resolvedAt: new Date(),
          },
        });
        await prisma.notification.createMany({
          data: losers.map((c) => ({
            userId: c.team.userId,
            leagueId,
            type: 'waiver_result',
            message: `Your waiver claim for ${claim.artist.name} was lost to ${claim.team.name} (higher waiver priority).`,
          })),
        });
        remaining = remaining.filter((c) => c.artistId !== claim.artistId);
      }
    }
  }
}
