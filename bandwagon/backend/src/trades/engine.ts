import { prisma } from '../db/prisma';
import { artistEligibleForSlot } from '../api/routes/leagues';
import { logLeagueEvent } from '../events/leagueEvents';

// Trades may be proposed/accepted through the end of week 7; accepted trades
// execute at the weekly finalize (Monday ~00:01 PT = end of the Sunday scoring
// day), and pending proposals are cancelled at the week-7 finalize.
export const TRADE_DEADLINE_WEEK = 7;

export interface RosterArtist {
  id: string;
  primaryGenre: string;
}

// Kuhn's augmenting-path bipartite matching over a team's <= 9 slots, seeded
// with the kept artists' current slots. Kept artists only relocate when an
// augmenting path needs their slot (e.g. an incoming Country artist takes
// Flex, pushing the Pop artist parked there back to the open Pop slot).
// Returns slot -> artistId for every occupied slot, or null when some
// incoming artist has no legal placement.
export function assignRoster(
  keep: { slot: string; artist: RosterArtist }[],
  incoming: RosterArtist[],
  allSlots: string[],
): Map<string, string> | null {
  const artistAt = new Map<string, RosterArtist>();
  for (const k of keep) artistAt.set(k.slot, k.artist);

  function tryPlace(artist: RosterArtist, visited: Set<string>): boolean {
    for (const slot of allSlots) {
      if (visited.has(slot) || !artistEligibleForSlot(artist.primaryGenre, slot)) continue;
      visited.add(slot);
      const occupant = artistAt.get(slot);
      if (!occupant || tryPlace(occupant, visited)) {
        artistAt.set(slot, artist);
        return true;
      }
    }
    return false;
  }

  for (const artist of incoming) {
    if (!tryPlace(artist, new Set())) return null;
  }

  const result = new Map<string, string>();
  for (const [slot, artist] of artistAt) result.set(slot, artist.id);
  return result;
}

// Drops required to keep the roster at (or under) its 9 fixed slots after the
// trade. Rosters with existing empty slots need fewer (or no) drops.
export function requiredDropCount(filledCount: number, outgoing: number, incoming: number): number {
  return Math.max(0, filledCount - outgoing + incoming - 9);
}

// Artist ids referenced by any item of an accepted (not yet executed) trade in
// this league. These artists are locked: they can't be claim-dropped or put
// into another trade until the accepted trade resolves.
export async function lockedArtistIds(leagueId: string, excludeTradeId?: string): Promise<Set<string>> {
  const items = await prisma.tradeItem.findMany({
    where: {
      trade: {
        leagueId,
        status: 'accepted',
        ...(excludeTradeId && { id: { not: excludeTradeId } }),
      },
    },
    select: { artistId: true },
  });
  return new Set(items.map((i) => i.artistId));
}

type RosterSpotRow = {
  id: string;
  slot: string;
  artistId: string | null;
  artist: { id: string; primaryGenre: string } | null;
};

export type TradeSide = {
  teamId: string;
  outgoing: string[]; // artist ids leaving the roster (traded away + dropped)
  incoming: RosterArtist[]; // artists arriving
};

export type OutcomeResult =
  | { ok: true; assignments: Map<string, Map<string, string>> } // teamId -> (slot -> artistId)
  | { ok: false; reason: string };

// Validates that each side's post-trade roster has a legal slot assignment,
// and returns the assignments for execution. Also verifies every outgoing
// artist is actually on that team's roster.
export async function validateTradeOutcome(
  db: { rosterSpot: { findMany: (args: any) => Promise<RosterSpotRow[]> } },
  sides: TradeSide[],
): Promise<OutcomeResult> {
  const assignments = new Map<string, Map<string, string>>();

  for (const side of sides) {
    const spots: RosterSpotRow[] = await db.rosterSpot.findMany({
      where: { teamId: side.teamId },
      select: { id: true, slot: true, artistId: true, artist: { select: { id: true, primaryGenre: true } } },
    });

    const onRoster = new Set(spots.filter((s) => s.artistId).map((s) => s.artistId!));
    for (const artistId of side.outgoing) {
      if (!onRoster.has(artistId)) {
        return { ok: false, reason: 'An artist in this trade is no longer on the expected roster' };
      }
    }

    const outgoingSet = new Set(side.outgoing);
    const keep = spots
      .filter((s) => s.artist && !outgoingSet.has(s.artist.id))
      .map((s) => ({ slot: s.slot, artist: { id: s.artist!.id, primaryGenre: s.artist!.primaryGenre } }));

    const filledAfter = keep.length + side.incoming.length;
    if (filledAfter > spots.length) {
      return { ok: false, reason: 'Trade would leave a roster with more players than slots' };
    }

    const assignment = assignRoster(keep, side.incoming, spots.map((s) => s.slot));
    if (!assignment) {
      return { ok: false, reason: 'Trade would leave a roster without a legal slot for every player' };
    }
    assignments.set(side.teamId, assignment);
  }

  return { ok: true, assignments };
}

// Builds the two TradeSides (proposer + receiver) from a trade's items.
export function sidesFromItems(
  proposerTeamId: string,
  receiverTeamId: string,
  items: { artistId: string; fromTeamId: string; toTeamId: string | null; artist: { id: string; primaryGenre: string } }[],
): TradeSide[] {
  const side = (teamId: string): TradeSide => ({
    teamId,
    outgoing: items.filter((i) => i.fromTeamId === teamId).map((i) => i.artistId),
    incoming: items
      .filter((i) => i.toTeamId === teamId)
      .map((i) => ({ id: i.artist.id, primaryGenre: i.artist.primaryGenre })),
  });
  return [side(proposerTeamId), side(receiverTeamId)];
}

async function notifyTeams(
  db: { team: { findMany: (args: any) => Promise<{ userId: string }[]> }; notification: { createMany: (args: any) => Promise<unknown> } },
  leagueId: string,
  teamIds: string[],
  type: string,
  message: string,
): Promise<void> {
  const teams = await db.team.findMany({ where: { id: { in: teamIds } }, select: { userId: true } });
  if (teams.length === 0) return;
  await db.notification.createMany({
    data: teams.map((t) => ({ userId: t.userId, leagueId, type, message })),
  });
}

class TradeExecutionError extends Error {}

// Executes every accepted trade in the league. Idempotent: a guarded
// status transition inside each trade's transaction is the claim gate, so
// concurrent or repeated finalize runs can't double-apply a trade.
export async function executeAcceptedTrades(leagueId: string): Promise<void> {
  const trades = await prisma.trade.findMany({
    where: { leagueId, status: 'accepted' },
    include: {
      items: { include: { artist: { select: { id: true, name: true, primaryGenre: true } } } },
      proposerTeam: { select: { id: true, name: true } },
      receiverTeam: { select: { id: true, name: true } },
    },
  });

  for (const trade of trades) {
    const teamIds = [trade.proposerTeamId, trade.receiverTeamId];
    const label = `${trade.proposerTeam.name} ↔ ${trade.receiverTeam.name}`;
    try {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.trade.updateMany({
          where: { id: trade.id, status: 'accepted' },
          data: { status: 'executed', resolvedAt: new Date() },
        });
        if (count === 0) return; // another run claimed it

        const outcome = await validateTradeOutcome(
          tx as any,
          sidesFromItems(trade.proposerTeamId, trade.receiverTeamId, trade.items),
        );
        if (!outcome.ok) throw new TradeExecutionError(outcome.reason);

        for (const teamId of teamIds) {
          const assignment = outcome.assignments.get(teamId)!;
          const spots = await tx.rosterSpot.findMany({ where: { teamId }, select: { id: true, slot: true, artistId: true } });
          // Clear changed spots first so an artist is never on two spots at once
          for (const spot of spots) {
            const next = assignment.get(spot.slot) ?? null;
            if (spot.artistId !== next && spot.artistId !== null) {
              await tx.rosterSpot.update({ where: { id: spot.id }, data: { artistId: null } });
            }
          }
          for (const spot of spots) {
            const next = assignment.get(spot.slot) ?? null;
            if (next !== null && spot.artistId !== next) {
              await tx.rosterSpot.update({ where: { id: spot.id }, data: { artistId: next } });
            }
          }
        }

        await notifyTeams(tx as any, leagueId, teamIds, 'trade_executed', `Trade executed: ${label}. Check your roster.`);
        const moves = trade.items
          .map((i) => (i.toTeamId === null
            ? `${i.artist.name} to free agency`
            : `${i.artist.name} to ${i.toTeamId === trade.proposerTeamId ? trade.proposerTeam.name : trade.receiverTeam.name}`))
          .join(', ');
        await logLeagueEvent(tx, leagueId, 'trade_executed', `Trade executed: ${label}. ${moves}`);
        console.log(`[trades] executed trade ${trade.id} (${label})`);
      });
    } catch (err) {
      if (err instanceof TradeExecutionError) {
        await prisma.trade.updateMany({
          where: { id: trade.id, status: 'accepted' },
          data: { status: 'failed', resolvedAt: new Date() },
        });
        await notifyTeams(prisma as any, leagueId, teamIds, 'trade_failed', `Trade ${label} could not be executed: ${err.message}.`);
        console.warn(`[trades] trade ${trade.id} failed: ${err.message}`);
      } else {
        throw err;
      }
    }
  }
}

// Cancels proposals still pending when the trade deadline (end of week 7) hits.
export async function cancelPendingTradesAtDeadline(leagueId: string): Promise<void> {
  const pending = await prisma.trade.findMany({
    where: { leagueId, status: 'pending' },
    select: { id: true, proposerTeamId: true, receiverTeamId: true },
  });
  if (pending.length === 0) return;

  const { count } = await prisma.trade.updateMany({
    where: { id: { in: pending.map((t) => t.id) }, status: 'pending' },
    data: { status: 'cancelled', resolvedAt: new Date() },
  });
  if (count === 0) return;

  const teamIds = [...new Set(pending.flatMap((t) => [t.proposerTeamId, t.receiverTeamId]))];
  await notifyTeams(prisma as any, leagueId, teamIds, 'trade_cancelled', 'A pending trade was cancelled: the trade deadline (end of week 7) has passed.');
  console.log(`[trades] league ${leagueId} — cancelled ${count} pending trade(s) at the deadline`);
}

// Single entry point for the weekly finalize pipeline.
export async function runTradeFinalizeSteps(leagueId: string, week: number): Promise<void> {
  await executeAcceptedTrades(leagueId);
  if (week >= TRADE_DEADLINE_WEEK) {
    await cancelPendingTradesAtDeadline(leagueId);
  }
}
