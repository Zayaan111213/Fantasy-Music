import type { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma';
import { makePick } from '../api/routes/draft';

const JWT_SECRET = process.env.JWT_SECRET || 'bandwagon-dev-secret';
const PICK_SECONDS = 60;
const ALL_SLOTS = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Other', 'Flex', 'Bench-1', 'Bench-2', 'Bench-3'];
const MAIN_GENRES = new Set(['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country']);

function findBestSlot(genre: string, openSlots: string[]): string | null {
  const priority = [
    genre,
    ...(MAIN_GENRES.has(genre) ? [] : ['Other']),
    'Flex',
    'Bench-1', 'Bench-2', 'Bench-3',
  ];
  for (const slot of priority) {
    if (openSlots.includes(slot)) return slot;
  }
  return null;
}

// Per-league per-pick timer (interval)
const leagueTimers = new Map<string, ReturnType<typeof setInterval>>();

function clearLeagueTimer(leagueId: string) {
  const t = leagueTimers.get(leagueId);
  if (t) { clearInterval(t); leagueTimers.delete(leagueId); }
}

// Pre-draft countdown timers (timeout, fires once)
const countdownTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearCountdownTimer(leagueId: string) {
  const t = countdownTimers.get(leagueId);
  if (t) { clearTimeout(t); countdownTimers.delete(leagueId); }
}

async function startPickTimer(io: Server, leagueId: string) {
  clearLeagueTimer(leagueId);

  let seconds = PICK_SECONDS;
  const interval = setInterval(async () => {
    seconds--;
    io.to(`draft:${leagueId}`).emit('draft:tick', seconds);

    if (seconds <= 0) {
      clearLeagueTimer(leagueId);
      await fireAutoDraft(io, leagueId);
    }
  }, 1000);
  leagueTimers.set(leagueId, interval);
}

async function transitionToLiveDraft(io: Server, leagueId: string) {
  const timerEndsAt = new Date(Date.now() + 60_000);

  await prisma.$transaction([
    prisma.league.update({ where: { id: leagueId }, data: { status: 'drafting' } }),
    prisma.draftState.update({ where: { leagueId }, data: { timerEndsAt } }),
  ]);

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      draftState: true,
      teams: {
        include: { user: { select: { username: true, avatarUrl: true } } },
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

  if (!league) return;

  io.to(`draft:${leagueId}`).emit('draft:state', {
    status: 'drafting',
    currentPickIndex: league.draftState?.currentPick ?? 0,
    pickOrder: league.draftState?.pickOrder ?? [],
    timerEndsAt,
    isComplete: false,
    teams: league.teams,
    picks: league.draftPicks,
    countdownEndsAt: null,
  });

  await startPickTimer(io, leagueId);
}

async function fireAutoDraft(io: Server, leagueId: string) {
  const draftState = await prisma.draftState.findUnique({ where: { leagueId } });
  if (!draftState || draftState.isComplete) return;

  const onClockTeamId = draftState.pickOrder[draftState.currentPick];
  const team = await prisma.team.findUnique({ where: { id: onClockTeamId }, include: { rosterSpots: true } });
  if (!team) return;

  const filledSlots = new Set(team.rosterSpots.filter((s) => s.artistId).map((s) => s.slot));
  const openSlots = ALL_SLOTS.filter((s) => !filledSlots.has(s));
  if (openSlots.length === 0) return;

  const draftedIds = (await prisma.draftPick.findMany({ where: { leagueId }, select: { artistId: true } }))
    .map((p) => p.artistId);

  function isEligible(genre: string, slot: string): boolean {
    if (slot.startsWith('Bench') || slot === 'Flex') return true;
    if (slot === 'Other') return !MAIN_GENRES.has(genre);
    return genre === slot;
  }

  for (const slot of openSlots) {
    const bestArtist = await prisma.artist.findFirst({
      where: { id: { notIn: draftedIds } },
      include: { weeklyScores: { orderBy: { week: 'desc' }, take: 1 } },
      orderBy: { name: 'asc' },
    });

    if (!bestArtist) continue;

    // Find best eligible undrafted artist for this slot
    const eligibleArtists = await prisma.artist.findMany({
      where: { id: { notIn: draftedIds } },
      include: { weeklyScores: { orderBy: { week: 'desc' }, take: 1 } },
    });

    const eligible = eligibleArtists
      .filter((a) => isEligible(a.primaryGenre, slot))
      .sort((a, b) => (b.weeklyScores[0]?.totalPoints ?? 0) - (a.weeklyScores[0]?.totalPoints ?? 0));

    if (eligible.length === 0) continue;

    const result = await makePick(leagueId, team.userId, eligible[0].id, slot, true);

    if ('error' in result) continue;

    io.to(`draft:${leagueId}`).emit('draft:pick-made', {
      ...result.pick,
      isAutoDraft: true,
    });

    if (result.isComplete) {
      clearLeagueTimer(leagueId);
      io.to(`draft:${leagueId}`).emit('draft:complete');
      return;
    }

    // Continue to next slot in the same auto-draft if team still has open slots
    // (auto-draft fires once per timer expiry, one pick per expiry)
    break;
  }

  await startPickTimer(io, leagueId);
}

export function registerDraftSocket(io: Server) {
  io.on('connection', (socket: Socket) => {
    let socketUserId: string | null = null;

    socket.on('draft:join', async ({ leagueId, token }: { leagueId: string; token: string }) => {
      try {
        const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
        socketUserId = payload.userId;

        await socket.join(`draft:${leagueId}`);

        const league = await prisma.league.findUnique({
          where: { id: leagueId },
          include: {
            draftState: true,
            teams: {
              include: { user: { select: { username: true, avatarUrl: true } } },
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

        if (!league) { socket.emit('draft:error', 'League not found'); return; }

        if (league.status === 'pre_draft') {
          const countdownEndsAt = league.draftTime;

          socket.emit('draft:state', {
            status: 'pre_draft',
            currentPickIndex: 0,
            pickOrder: league.draftState?.pickOrder ?? [],
            timerEndsAt: null,
            isComplete: false,
            teams: league.teams,
            picks: league.draftPicks,
            myUserId: socketUserId,
            countdownEndsAt,
          });

          // Start countdown if not already running
          if (!countdownTimers.has(leagueId) && countdownEndsAt) {
            const msRemaining = Math.max(0, countdownEndsAt.getTime() - Date.now());
            const timeout = setTimeout(() => {
              countdownTimers.delete(leagueId);
              transitionToLiveDraft(io, leagueId);
            }, msRemaining);
            countdownTimers.set(leagueId, timeout);
          }
          return;
        }

        socket.emit('draft:state', {
          status: league.status,
          currentPickIndex: league.draftState?.currentPick ?? 0,
          pickOrder: league.draftState?.pickOrder ?? [],
          timerEndsAt: league.draftState?.timerEndsAt ?? null,
          isComplete: league.draftState?.isComplete ?? false,
          teams: league.teams,
          picks: league.draftPicks,
          myUserId: socketUserId,
          countdownEndsAt: null,
        });

        // If drafting and no timer running, start one
        if (league.status === 'drafting' && !league.draftState?.isComplete && !leagueTimers.has(leagueId)) {
          await startPickTimer(io, leagueId);
        }
      } catch {
        socket.emit('draft:error', 'Authentication failed');
      }
    });

    socket.on('draft:skip-countdown', async ({ leagueId, token }: { leagueId: string; token: string }) => {
      try {
        const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
        const league = await prisma.league.findUnique({ where: { id: leagueId } });
        if (!league) { socket.emit('draft:error', 'League not found'); return; }
        if (league.commissionerId !== payload.userId) {
          socket.emit('draft:error', 'Only the commissioner can skip the countdown');
          return;
        }
        if (league.status !== 'pre_draft') return;

        clearCountdownTimer(leagueId);
        await transitionToLiveDraft(io, leagueId);
      } catch {
        socket.emit('draft:error', 'Failed to skip countdown');
      }
    });

    socket.on('draft:pick', async ({ leagueId, artistId, token }: {
      leagueId: string; artistId: string; token: string;
    }) => {
      try {
        const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
        const userId = payload.userId;

        // Resolve which team is picking and find their open slots
        const draftState = await prisma.draftState.findUnique({ where: { leagueId } });
        if (!draftState) { socket.emit('draft:error', 'Draft not found'); return; }

        const onClockTeamId = draftState.pickOrder[draftState.currentPick];
        const team = await prisma.team.findUnique({ where: { id: onClockTeamId }, include: { rosterSpots: true } });
        if (!team) { socket.emit('draft:error', 'Team not found'); return; }

        const filledSlots = new Set(team.rosterSpots.filter((s) => s.artistId).map((s) => s.slot));
        const openSlots = ALL_SLOTS.filter((s) => !filledSlots.has(s));

        const artist = await prisma.artist.findUnique({ where: { id: artistId } });
        if (!artist) { socket.emit('draft:error', 'Artist not found'); return; }

        const slot = findBestSlot(artist.primaryGenre, openSlots);
        if (!slot) {
          socket.emit('draft:error', `No eligible slot for ${artist.name}`);
          return;
        }

        const result = await makePick(leagueId, userId, artistId, slot, false);

        if ('error' in result) {
          socket.emit('draft:error', result.error);
          return;
        }

        clearLeagueTimer(leagueId);
        io.to(`draft:${leagueId}`).emit('draft:pick-made', result.pick);

        if (result.isComplete) {
          io.to(`draft:${leagueId}`).emit('draft:complete');
          return;
        }

        await startPickTimer(io, leagueId);
      } catch {
        socket.emit('draft:error', 'Pick failed');
      }
    });

    socket.on('disconnect', () => {
      socketUserId = null;
    });
  });
}
