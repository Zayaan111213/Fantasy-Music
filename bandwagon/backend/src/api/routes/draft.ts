import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAuth, type AuthRequest } from '../middleware/auth';

const router = Router();

export const ALL_SLOTS = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Other', 'Flex', 'Bench-1', 'Bench-2', 'Bench-3'];

const MAIN_GENRE_SLOTS = new Set(['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country']);

export function isEligible(genre: string, slot: string): boolean {
  if (slot.startsWith('Bench') || slot === 'Flex') return true;
  if (slot === 'Other') return !MAIN_GENRE_SLOTS.has(genre);
  return genre === slot;
}

// Get draft state for a league
router.get('/:id/draft', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const league = await prisma.league.findUnique({
      where: { id: req.params.id },
      include: {
        draftState: true,
        teams: {
          include: {
            user: { select: { username: true, avatarUrl: true } },
            rosterSpots: true,
          },
          orderBy: { draftPosition: 'asc' },
        },
        draftPicks: {
          include: {
            artist: { select: { id: true, name: true, primaryGenre: true, imageUrl: true } },
            team: { select: { id: true, name: true, logoUrl: true } },
          },
          orderBy: { pickNumber: 'asc' },
        },
      },
    });

    if (!league) { res.status(404).json({ error: 'League not found' }); return; }

    const totalPicks = league.teamCount * ALL_SLOTS.length;
    const picksMade = league.draftPicks.length;
    const draftState = league.draftState;

    res.json({
      status: league.status,
      draftTime: league.draftTime,
      totalPicks,
      picksMade,
      currentPickIndex: draftState?.currentPick ?? 0,
      pickOrder: draftState?.pickOrder ?? [],
      timerEndsAt: draftState?.timerEndsAt ?? null,
      isComplete: draftState?.isComplete ?? false,
      teams: league.teams,
      picks: league.draftPicks,
    });
  } catch (err) {
    next(err);
  }
});

// Start draft (commissioner only)
router.post('/:id/draft/start', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const league = await prisma.league.findUnique({
      where: { id: req.params.id },
      include: { teams: { orderBy: { draftPosition: 'asc' } } },
    });

    if (!league) { res.status(404).json({ error: 'League not found' }); return; }
    if (league.commissionerId !== req.userId) { res.status(403).json({ error: 'Only the commissioner can start the draft' }); return; }
    if (league.status !== 'pending') { res.status(400).json({ error: 'Draft has already started or ended' }); return; }
    if (league.teams.length < 2) { res.status(400).json({ error: 'Need at least 2 teams to start the draft' }); return; }

    // Build snake order: 9 rounds
    const teamIds = league.teams.map((t) => t.id);
    const pickOrder: string[] = [];
    for (let round = 0; round < ALL_SLOTS.length; round++) {
      const roundTeams = round % 2 === 0 ? teamIds : [...teamIds].reverse();
      pickOrder.push(...roundTeams);
    }

    const draftStartsAt = new Date(Date.now() + 10 * 60_000);

    await prisma.$transaction([
      prisma.league.update({ where: { id: req.params.id }, data: { status: 'pre_draft', draftTime: draftStartsAt } }),
      prisma.draftState.upsert({
        where: { leagueId: req.params.id },
        create: { leagueId: req.params.id, currentPick: 0, pickOrder, timerEndsAt: null },
        update: { currentPick: 0, pickOrder, timerEndsAt: null, isComplete: false },
      }),
    ]);

    res.json({ message: 'Draft starting', draftStartsAt, pickOrder });
  } catch (err) {
    next(err);
  }
});

// Make a draft pick (also called by socket handler internally)
router.post('/:id/draft/pick', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({ artistId: z.string(), slot: z.string() });
    const { artistId, slot } = schema.parse(req.body);

    const result = await makePick(req.params.id, req.userId!, artistId, slot, false);
    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export async function makePick(
  leagueId: string,
  userId: string,
  artistId: string,
  slot: string,
  isAutoDraft: boolean
): Promise<{ pick: object; isComplete: boolean } | { error: string }> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      draftState: true,
      teams: { orderBy: { draftPosition: 'asc' } },
    },
  });

  if (!league || !league.draftState) return { error: 'Draft not found' };
  if (league.status !== 'drafting') return { error: 'Draft is not active' };
  if (league.draftState.isComplete) return { error: 'Draft is complete' };

  const { currentPick, pickOrder } = league.draftState;
  const onClockTeamId = pickOrder[currentPick];
  const onClockTeam = league.teams.find((t) => t.id === onClockTeamId);

  if (!onClockTeam) return { error: 'Invalid draft state' };
  if (!isAutoDraft && onClockTeam.userId !== userId) return { error: 'It is not your turn' };

  // Check artist not already drafted in this league
  const alreadyPicked = await prisma.draftPick.findFirst({
    where: { leagueId, artistId },
  });
  if (alreadyPicked) return { error: 'Artist already drafted' };

  const artist = await prisma.artist.findUnique({ where: { id: artistId } });
  if (!artist) return { error: 'Artist not found' };
  if (!isEligible(artist.primaryGenre, slot)) {
    return { error: `${artist.name} is not eligible for the ${slot} slot` };
  }

  // Check slot not already filled for this team
  const existingSpot = await prisma.rosterSpot.findUnique({
    where: { teamId_slot: { teamId: onClockTeamId, slot } },
  });
  if (existingSpot?.artistId) return { error: `${slot} slot already filled` };

  const round = Math.floor(currentPick / league.teams.length);
  const pickNumber = currentPick + 1;
  const nextPick = currentPick + 1;
  const totalPicks = league.teams.length * ALL_SLOTS.length;
  const isComplete = nextPick >= totalPicks;

  const timerEndsAt = isComplete ? null : new Date(Date.now() + 60_000);

  await prisma.$transaction(async (tx) => {
    // Record pick
    await tx.draftPick.create({
      data: { leagueId, teamId: onClockTeamId, artistId, round, pickNumber, slot, isAutoDraft },
    });

    // Update or create roster spot
    await tx.rosterSpot.upsert({
      where: { teamId_slot: { teamId: onClockTeamId, slot } },
      create: { teamId: onClockTeamId, artistId, slot },
      update: { artistId },
    });

    // Advance draft state
    await tx.draftState.update({
      where: { leagueId },
      data: {
        currentPick: nextPick,
        timerEndsAt,
        isComplete,
      },
    });

    if (isComplete) {
      // Initialize empty slots for all teams that didn't get auto-filled
      const teams = await tx.team.findMany({ where: { leagueId } });
      for (const team of teams) {
        for (const s of ALL_SLOTS) {
          await tx.rosterSpot.upsert({
            where: { teamId_slot: { teamId: team.id, slot: s } },
            create: { teamId: team.id, slot: s, artistId: null },
            update: {},
          });
        }
      }

      // Generate round-robin matchups for 10 weeks
      const allTeams = await tx.team.findMany({ where: { leagueId }, orderBy: { draftPosition: 'asc' } });
      const ids = allTeams.map((t) => t.id);
      const matchups = [];
      for (let week = 1; week <= 10; week++) {
        for (let i = 0; i < Math.floor(ids.length / 2); i++) {
          const j = ids.length - 1 - i;
          if (i !== j) {
            matchups.push({ leagueId, week, homeTeamId: ids[i], awayTeamId: ids[j] });
          }
        }
        // Rotate (except position 0)
        ids.splice(1, 0, ids.pop()!);
      }
      await tx.matchup.createMany({ data: matchups });

      await tx.league.update({ where: { id: leagueId }, data: { status: 'active', currentWeek: 1 } });
    }
  });

  const pick = await prisma.draftPick.findFirst({
    where: { leagueId, pickNumber },
    include: {
      artist: { select: { id: true, name: true, primaryGenre: true, imageUrl: true } },
      team: { select: { id: true, name: true, logoUrl: true } },
    },
  });

  return { pick: pick!, isComplete };
}

export default router;
