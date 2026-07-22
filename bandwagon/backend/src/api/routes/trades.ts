import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import {
  lockedArtistIds,
  requiredDropCount,
  sidesFromItems,
  validateTradeOutcome,
  TRADE_DEADLINE_WEEK,
} from '../../trades/engine';
import { logLeagueEvent } from '../../events/leagueEvents';
import { getPTParts } from '../../jobs/scheduler';
import { getCurrentWeekDate } from '../../jobs/ingestCharts';

const router = Router();

const artistSelect = {
  select: {
    id: true,
    name: true,
    primaryGenre: true,
    imageUrl: true,
    // Last 5 chart weeks for the Last/5W-avg stats shown when a trade row is
    // expanded (same figures as the player lists).
    weeklyScores: {
      where: { weekDate: { lte: getCurrentWeekDate() } },
      orderBy: { weekDate: 'desc' as const },
      take: 5,
      select: { totalPoints: true },
    },
  },
};

function artistWithStats(artist: { id: string; name: string; primaryGenre: string; imageUrl: string | null; weeklyScores: { totalPoints: number }[] }) {
  return {
    id: artist.id,
    name: artist.name,
    primaryGenre: artist.primaryGenre,
    imageUrl: artist.imageUrl,
    lastWeekPoints: artist.weeklyScores[0]?.totalPoints ?? 0,
    avgLast5Points: artist.weeklyScores.length > 0
      ? artist.weeklyScores.reduce((sum, w) => sum + w.totalPoints, 0) / artist.weeklyScores.length
      : 0,
  };
}

// Resolved trades stay in the Trades section for the rest of the Pacific day
// they resolved (so both sides see the outcome), then drop out. The activity
// feed keeps the permanent record.
const TERMINAL_TRADE_STATUSES = new Set(['rejected', 'cancelled', 'vetoed', 'executed', 'failed']);

export function tradeVisibleToday(
  trade: { status: string; resolvedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (!TERMINAL_TRADE_STATUSES.has(trade.status)) return true;
  if (!trade.resolvedAt) return false; // terminal without a timestamp = stale
  return getPTParts(trade.resolvedAt).dateStr === getPTParts(now).dateStr;
}

type LeagueCtx = NonNullable<Awaited<ReturnType<typeof loadLeagueWithTeams>>>;
type CtxResult =
  | { error: string; status: number; league?: undefined; myTeam?: undefined }
  | { error?: undefined; status?: undefined; league: LeagueCtx; myTeam: LeagueCtx['teams'][number] };

function loadLeagueWithTeams(leagueId: string) {
  return prisma.league.findUnique({
    where: { id: leagueId },
    include: { teams: { select: { id: true, name: true, userId: true } } },
  });
}

async function leagueAndMyTeam(leagueId: string, userId: string): Promise<CtxResult> {
  const league = await loadLeagueWithTeams(leagueId);
  if (!league) return { error: 'League not found', status: 404 };
  const myTeam = league.teams.find((t) => t.userId === userId);
  if (!myTeam) return { error: 'You are not in this league', status: 403 };
  return { league, myTeam };
}

function tradingClosed(league: { status: string; currentWeek: number }): string | null {
  if (league.status !== 'active') return 'Trading is only available during the active season';
  if (league.currentWeek > TRADE_DEADLINE_WEEK) return `The trade deadline (end of week ${TRADE_DEADLINE_WEEK}) has passed`;
  return null;
}

// Every team's roster — feeds the My Team roster browser and trade flows.
// Artists carry their current-week score (same shape as GET /:id/roster) so
// roster rows can show points for other teams too.
router.get('/:id/teams-with-rosters', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ctx = await leagueAndMyTeam(req.params.id, req.userId!);
    if (ctx.error !== undefined) { res.status(ctx.status).json({ error: ctx.error }); return; }
    const { league } = ctx;

    const teams = await prisma.team.findMany({
      where: { leagueId: req.params.id },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        userId: true,
        rosterSpots: {
          select: {
            slot: true,
            artist: {
              select: {
                id: true,
                name: true,
                primaryGenre: true,
                imageUrl: true,
                weeklyScores: { where: { weekDate: getCurrentWeekDate() } },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    res.json(teams);
  } catch (err) {
    next(err);
  }
});

// All trades in the league, newest first.
router.get('/:id/trades', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ctx = await leagueAndMyTeam(req.params.id, req.userId!);
    if (ctx.error !== undefined) { res.status(ctx.status).json({ error: ctx.error }); return; }
    const { league, myTeam } = ctx;

    const trades = await prisma.trade.findMany({
      where: { leagueId: req.params.id },
      include: {
        items: { include: { artist: artistSelect } },
        proposerTeam: { select: { id: true, name: true } },
        receiverTeam: { select: { id: true, name: true } },
        vetoes: { select: { teamId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      myTeamId: myTeam.id,
      vetoesNeeded: Math.max(league.teams.length - 2, 0),
      tradingClosed: tradingClosed(league),
      trades: trades.filter((t) => tradeVisibleToday(t)).map((t) => ({
        id: t.id,
        status: t.status,
        createdAt: t.createdAt,
        acceptedAt: t.acceptedAt,
        resolvedAt: t.resolvedAt,
        proposerTeam: t.proposerTeam,
        receiverTeam: t.receiverTeam,
        items: t.items.map((i) => ({
          id: i.id,
          artistId: i.artistId,
          fromTeamId: i.fromTeamId,
          toTeamId: i.toTeamId,
          artist: artistWithStats(i.artist),
        })),
        vetoCount: t.vetoes.length,
        myVetoed: t.vetoes.some((v) => v.teamId === myTeam.id),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Propose a trade. The proposer designates their own drops here (needed only
// when they'd net more players than their open slots can hold).
router.post('/:id/trades', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      toTeamId: z.string(),
      give: z.array(z.string()).min(1),
      receive: z.array(z.string()).min(1),
      drops: z.array(z.string()).default([]),
    });
    const { toTeamId, give, receive, drops } = schema.parse(req.body);

    const ctx = await leagueAndMyTeam(req.params.id, req.userId!);
    if (ctx.error !== undefined) { res.status(ctx.status).json({ error: ctx.error }); return; }
    const { league, myTeam } = ctx;

    const closed = tradingClosed(league);
    if (closed) { res.status(400).json({ error: closed }); return; }

    const toTeam = league.teams.find((t) => t.id === toTeamId);
    if (!toTeam || toTeam.id === myTeam.id) {
      res.status(400).json({ error: 'Pick another team in this league to trade with' });
      return;
    }

    const mine = [...give, ...drops];
    if (new Set(mine).size !== mine.length || new Set(receive).size !== receive.length) {
      res.status(400).json({ error: 'The same artist appears twice in the trade' });
      return;
    }

    const [mySpots, theirSpots] = await Promise.all([
      prisma.rosterSpot.findMany({ where: { teamId: myTeam.id }, select: { artistId: true } }),
      prisma.rosterSpot.findMany({ where: { teamId: toTeam.id }, select: { artistId: true } }),
    ]);
    const myArtists = new Set(mySpots.map((s) => s.artistId).filter(Boolean) as string[]);
    const theirArtists = new Set(theirSpots.map((s) => s.artistId).filter(Boolean) as string[]);
    if (!mine.every((a) => myArtists.has(a))) {
      res.status(400).json({ error: 'You can only give or drop artists on your own roster' });
      return;
    }
    if (!receive.every((a) => theirArtists.has(a))) {
      res.status(400).json({ error: `You can only request artists on ${toTeam.name}'s roster` });
      return;
    }

    const dropsNeeded = requiredDropCount(myArtists.size, give.length, receive.length);
    if (drops.length !== dropsNeeded) {
      res.status(400).json({
        error: dropsNeeded === 0
          ? 'No drops are needed for this trade'
          : `You must drop exactly ${dropsNeeded} player${dropsNeeded === 1 ? '' : 's'} to make room`,
      });
      return;
    }

    const locked = await lockedArtistIds(req.params.id);
    const allIds = [...mine, ...receive];
    if (allIds.some((a) => locked.has(a))) {
      res.status(400).json({ error: 'An artist in this trade is locked in an already-accepted trade' });
      return;
    }

    const receiveArtists = await prisma.artist.findMany({
      where: { id: { in: receive } },
      select: { id: true, name: true, primaryGenre: true },
    });
    const outcome = await validateTradeOutcome(prisma as any, [
      { teamId: myTeam.id, outgoing: mine, incoming: receiveArtists },
    ]);
    if (!outcome.ok) {
      res.status(400).json({ error: 'This trade would leave your roster without a legal slot for every player' });
      return;
    }

    const giveArtists = await prisma.artist.findMany({ where: { id: { in: give } }, select: { id: true, name: true } });
    const giveNames = giveArtists.map((a) => a.name).join(', ');
    const receiveNames = receiveArtists.map((a) => a.name).join(', ');

    const trade = await prisma.$transaction(async (tx) => {
      const created = await tx.trade.create({
        data: { leagueId: req.params.id, proposerTeamId: myTeam.id, receiverTeamId: toTeam.id },
      });
      await tx.tradeItem.createMany({
        data: [
          ...give.map((artistId) => ({ tradeId: created.id, artistId, fromTeamId: myTeam.id, toTeamId: toTeam.id })),
          ...receive.map((artistId) => ({ tradeId: created.id, artistId, fromTeamId: toTeam.id, toTeamId: myTeam.id })),
          ...drops.map((artistId) => ({ tradeId: created.id, artistId, fromTeamId: myTeam.id, toTeamId: null })),
        ],
      });
      await tx.notification.createMany({
        data: [{
          userId: toTeam.userId,
          leagueId: req.params.id,
          type: 'trade_proposed',
          message: `${myTeam.name} proposed a trade: ${giveNames} for your ${receiveNames}. Review it in My Team → Trades.`,
        }],
      });
      return created;
    });

    res.json({ id: trade.id, status: trade.status });
  } catch (err) {
    next(err);
  }
});

// Accept a trade (receiving team only). The acceptor designates their drops.
router.post('/:id/trades/:tradeId/accept', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { drops } = z.object({ drops: z.array(z.string()).default([]) }).parse(req.body);

    const ctx = await leagueAndMyTeam(req.params.id, req.userId!);
    if (ctx.error !== undefined) { res.status(ctx.status).json({ error: ctx.error }); return; }
    const { league, myTeam } = ctx;

    const closed = tradingClosed(league);
    if (closed) { res.status(400).json({ error: closed }); return; }

    const trade = await prisma.trade.findFirst({
      where: { id: req.params.tradeId, leagueId: req.params.id },
      include: { items: { include: { artist: artistSelect } }, proposerTeam: { select: { id: true, name: true, userId: true } } },
    });
    if (!trade) { res.status(404).json({ error: 'Trade not found' }); return; }
    if (trade.receiverTeamId !== myTeam.id) { res.status(403).json({ error: 'Only the receiving team can accept this trade' }); return; }
    if (trade.status !== 'pending') { res.status(400).json({ error: 'This trade is no longer pending' }); return; }

    // Staleness: an artist may have been claim-dropped since the proposal.
    const teamIds = [trade.proposerTeamId, trade.receiverTeamId];
    const spots = await prisma.rosterSpot.findMany({
      where: { teamId: { in: teamIds } },
      select: { teamId: true, artistId: true },
    });
    const rosterOf = new Map<string, Set<string>>(teamIds.map((id) => [id, new Set()]));
    for (const s of spots) if (s.artistId) rosterOf.get(s.teamId)!.add(s.artistId);
    const stale = trade.items.some((i) => !rosterOf.get(i.fromTeamId)?.has(i.artistId));
    if (stale) {
      await prisma.trade.updateMany({
        where: { id: trade.id, status: 'pending' },
        data: { status: 'cancelled', resolvedAt: new Date() },
      });
      await prisma.notification.createMany({
        data: [{
          userId: trade.proposerTeam.userId,
          leagueId: req.params.id,
          type: 'trade_cancelled',
          message: `Your trade proposal to ${myTeam.name} was cancelled. A player in it is no longer on the expected roster.`,
        }],
      });
      res.status(409).json({ error: 'A player in this trade is no longer available; the trade was cancelled' });
      return;
    }

    const myOutgoing = trade.items.filter((i) => i.fromTeamId === myTeam.id).map((i) => i.artistId);
    const myIncoming = trade.items.filter((i) => i.toTeamId === myTeam.id);
    const myRoster = rosterOf.get(myTeam.id)!;
    if (new Set(drops).size !== drops.length) { res.status(400).json({ error: 'Duplicate drop' }); return; }
    if (!drops.every((a) => myRoster.has(a) && !myOutgoing.includes(a))) {
      res.status(400).json({ error: 'Drops must be players on your roster that are not already in the trade' });
      return;
    }
    const dropsNeeded = requiredDropCount(myRoster.size, myOutgoing.length, myIncoming.length);
    if (drops.length !== dropsNeeded) {
      res.status(400).json({
        error: dropsNeeded === 0
          ? 'No drops are needed for this trade'
          : `You must drop exactly ${dropsNeeded} player${dropsNeeded === 1 ? '' : 's'} to make room`,
      });
      return;
    }

    const locked = await lockedArtistIds(req.params.id, trade.id);
    if ([...trade.items.map((i) => i.artistId), ...drops].some((a) => locked.has(a))) {
      res.status(400).json({ error: 'An artist in this trade is locked in an already-accepted trade' });
      return;
    }

    const sides = sidesFromItems(trade.proposerTeamId, trade.receiverTeamId, trade.items);
    const mySide = sides.find((s) => s.teamId === myTeam.id)!;
    mySide.outgoing = [...mySide.outgoing, ...drops];
    const outcome = await validateTradeOutcome(prisma as any, sides);
    if (!outcome.ok) {
      res.status(400).json({ error: outcome.reason });
      return;
    }

    const nonInvolved = league.teams.filter((t) => !teamIds.includes(t.id));
    const accepted = await prisma.$transaction(async (tx) => {
      const { count } = await tx.trade.updateMany({
        where: { id: trade.id, status: 'pending' },
        data: { status: 'accepted', acceptedAt: new Date() },
      });
      if (count === 0) return false;
      if (drops.length > 0) {
        await tx.tradeItem.createMany({
          data: drops.map((artistId) => ({ tradeId: trade.id, artistId, fromTeamId: myTeam.id, toTeamId: null })),
        });
      }
      await tx.notification.createMany({
        data: [
          {
            userId: trade.proposerTeam.userId,
            leagueId: req.params.id,
            type: 'trade_accepted',
            message: `${myTeam.name} accepted your trade. It executes at the end of the scoring week (Sunday night) unless vetoed.`,
          },
          ...nonInvolved.map((t) => ({
            userId: t.userId,
            leagueId: req.params.id,
            type: 'trade_accepted',
            message: `Trade accepted in your league: ${trade.proposerTeam.name} ↔ ${myTeam.name}. You can veto it in My Team → Trades before Sunday night (unanimous veto required).`,
          })),
        ],
      });
      await logLeagueEvent(
        tx,
        req.params.id,
        'trade_accepted',
        `Trade accepted: ${trade.proposerTeam.name} ↔ ${myTeam.name}. Executes Sunday night unless vetoed`,
      );
      return true;
    });
    if (!accepted) { res.status(409).json({ error: 'This trade is no longer pending' }); return; }

    res.json({ id: trade.id, status: 'accepted' });
  } catch (err) {
    next(err);
  }
});

// Reject (receiving team only, while pending).
router.post('/:id/trades/:tradeId/reject', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ctx = await leagueAndMyTeam(req.params.id, req.userId!);
    if (ctx.error !== undefined) { res.status(ctx.status).json({ error: ctx.error }); return; }
    const { myTeam } = ctx;

    const trade = await prisma.trade.findFirst({
      where: { id: req.params.tradeId, leagueId: req.params.id },
      include: { proposerTeam: { select: { userId: true } } },
    });
    if (!trade) { res.status(404).json({ error: 'Trade not found' }); return; }
    if (trade.receiverTeamId !== myTeam.id) { res.status(403).json({ error: 'Only the receiving team can reject this trade' }); return; }

    const { count } = await prisma.trade.updateMany({
      where: { id: trade.id, status: 'pending' },
      data: { status: 'rejected', resolvedAt: new Date() },
    });
    if (count === 0) { res.status(409).json({ error: 'This trade is no longer pending' }); return; }

    await prisma.notification.createMany({
      data: [{ userId: trade.proposerTeam.userId, leagueId: req.params.id, type: 'trade_rejected', message: `${myTeam.name} rejected your trade proposal.` }],
    });
    res.json({ id: trade.id, status: 'rejected' });
  } catch (err) {
    next(err);
  }
});

// Cancel (proposing team only, while pending — accepted trades can only die by veto).
router.post('/:id/trades/:tradeId/cancel', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ctx = await leagueAndMyTeam(req.params.id, req.userId!);
    if (ctx.error !== undefined) { res.status(ctx.status).json({ error: ctx.error }); return; }
    const { myTeam } = ctx;

    const trade = await prisma.trade.findFirst({
      where: { id: req.params.tradeId, leagueId: req.params.id },
      include: { receiverTeam: { select: { userId: true } } },
    });
    if (!trade) { res.status(404).json({ error: 'Trade not found' }); return; }
    if (trade.proposerTeamId !== myTeam.id) { res.status(403).json({ error: 'Only the proposing team can cancel this trade' }); return; }

    const { count } = await prisma.trade.updateMany({
      where: { id: trade.id, status: 'pending' },
      data: { status: 'cancelled', resolvedAt: new Date() },
    });
    if (count === 0) { res.status(409).json({ error: 'This trade is no longer pending' }); return; }

    await prisma.notification.createMany({
      data: [{ userId: trade.receiverTeam.userId, leagueId: req.params.id, type: 'trade_cancelled', message: `${myTeam.name} cancelled their trade proposal.` }],
    });
    res.json({ id: trade.id, status: 'cancelled' });
  } catch (err) {
    next(err);
  }
});

// Veto an accepted trade. Only members not in the trade may vote; the trade is
// vetoed only when every non-involved team has voted (unanimous).
router.post('/:id/trades/:tradeId/veto', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ctx = await leagueAndMyTeam(req.params.id, req.userId!);
    if (ctx.error !== undefined) { res.status(ctx.status).json({ error: ctx.error }); return; }
    const { league, myTeam } = ctx;

    const trade = await prisma.trade.findFirst({
      where: { id: req.params.tradeId, leagueId: req.params.id },
      include: {
        proposerTeam: { select: { id: true, name: true, userId: true } },
        receiverTeam: { select: { id: true, name: true, userId: true } },
      },
    });
    if (!trade) { res.status(404).json({ error: 'Trade not found' }); return; }
    if (trade.proposerTeamId === myTeam.id || trade.receiverTeamId === myTeam.id) {
      res.status(403).json({ error: 'Teams in the trade cannot veto it' });
      return;
    }
    if (trade.status !== 'accepted') {
      res.status(400).json({ error: 'Veto voting is only open between acceptance and execution' });
      return;
    }

    try {
      await prisma.tradeVeto.create({ data: { tradeId: trade.id, teamId: myTeam.id } });
    } catch (err: any) {
      if (err?.code === 'P2002') { res.status(400).json({ error: 'You already voted to veto this trade' }); return; }
      throw err;
    }

    const vetoCount = await prisma.tradeVeto.count({ where: { tradeId: trade.id } });
    const vetoesNeeded = Math.max(league.teams.length - 2, 0);
    let vetoed = false;
    if (vetoesNeeded > 0 && vetoCount >= vetoesNeeded) {
      const { count } = await prisma.trade.updateMany({
        where: { id: trade.id, status: 'accepted' },
        data: { status: 'vetoed', resolvedAt: new Date() },
      });
      // Guarded on status: 'accepted' — if finalize executed this trade in the
      // gap between our status check above and this update, count is 0 and the
      // trade is actually 'executed'. Report what really happened, not what
      // this request tried to do.
      vetoed = count > 0;
      if (count > 0) {
        await prisma.notification.createMany({
          data: [trade.proposerTeam.userId, trade.receiverTeam.userId].map((userId) => ({
            userId,
            leagueId: req.params.id,
            type: 'trade_vetoed',
            message: `The trade ${trade.proposerTeam.name} ↔ ${trade.receiverTeam.name} was vetoed unanimously by the rest of the league.`,
          })),
        });
        await logLeagueEvent(
          prisma,
          req.params.id,
          'trade_vetoed',
          `Trade vetoed: ${trade.proposerTeam.name} ↔ ${trade.receiverTeam.name} was struck down unanimously by the league`,
        );
      }
    }

    res.json({ vetoCount, vetoesNeeded, vetoed });
  } catch (err) {
    next(err);
  }
});

export default router;
