import type { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma';
import { makePick, triggerInitialScoring } from '../api/routes/draft';

const JWT_SECRET = process.env.JWT_SECRET || 'bandwagon-dev-secret';
const PICK_SECONDS = 60;
const ALL_SLOTS = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Other', 'Flex', 'Bench-1', 'Bench-2', 'Bench-3'];
const MAIN_GENRES = new Set(['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country']);

// JWTs live 30 days, so a signature check alone would keep serving accounts
// deleted after the token was issued — same reasoning as requireAuth() for
// HTTP routes, which this mirrors since sockets have no shared middleware
// chain with Express here. Throws (caller's try/catch turns it into a
// generic "action failed" emit) if the token is invalid or the user is gone.
async function verifyActiveUser(token: string): Promise<string> {
  const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
  const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { deletedAt: true } });
  if (!user || user.deletedAt) throw new Error('Invalid token');
  return payload.userId;
}

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
    try {
      seconds--;
      io.to(`draft:${leagueId}`).emit('draft:tick', seconds);

      if (seconds <= 0) {
        clearLeagueTimer(leagueId);
        await fireAutoDraft(io, leagueId);
      }
    } catch (err) {
      // A bare async setInterval callback that throws becomes an unhandled
      // rejection, which crashes the whole process on Node 15+ — not just
      // this league's draft. Concretely reachable: fireAutoDraft's makePick
      // call has no try/catch of its own, so if it loses a race to a
      // simultaneous human draft:pick for the same pick number (the DB
      // unique constraint rejects the loser), that throw used to propagate
      // all the way out here uncaught.
      console.error(`[draft] league ${leagueId} — pick timer tick failed:`, err);
    }
  }, 1000);
  leagueTimers.set(leagueId, interval);
}

async function transitionToLiveDraft(io: Server, leagueId: string) {
  // The league may have been deleted while the pre-draft countdown was
  // running (commissioner delete, account deletion).
  const exists = await prisma.league.findUnique({ where: { id: leagueId }, select: { id: true } });
  if (!exists) return;

  const timerEndsAt = new Date(Date.now() + 60_000);

  await prisma.$transaction([
    prisma.league.update({ where: { id: leagueId }, data: { status: 'drafting', draftTime: new Date() } }),
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

  let picked = false;
  for (const slot of openSlots) {
    const bestArtist = await prisma.artist.findFirst({
      where: { id: { notIn: draftedIds }, hiddenAt: null },
      include: { weeklyScores: { orderBy: { weekDate: 'desc' }, take: 1 } },
      orderBy: { name: 'asc' },
    });

    if (!bestArtist) continue;

    // Find best eligible undrafted artist for this slot
    const eligibleArtists = await prisma.artist.findMany({
      where: { id: { notIn: draftedIds }, hiddenAt: null },
      include: { weeklyScores: { orderBy: { weekDate: 'desc' }, take: 1 } },
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
      triggerInitialScoring(leagueId).catch((err) =>
        console.error('[draft] initial scoring error:', err),
      );
      return;
    }

    // Continue to next slot in the same auto-draft if team still has open slots
    // (auto-draft fires once per timer expiry, one pick per expiry)
    picked = true;
    break;
  }

  if (!picked) {
    // No eligible artist for ANY of this team's open slots (the undrafted
    // pool is genre-thin — plausible for a small artist DB or a late pick in
    // a big league). Without this, the clock would silently restart forever
    // with no signal that the draft is stuck. Still restarting it below is
    // the least-bad option available here (there's no "skip this pick"
    // semantics to fall back to), but at least the room is told why.
    const msg = `${team.name} has no eligible artist for any open slot (${openSlots.join(', ')}). The pool may be exhausted; a commissioner may need to add artists or adjust the roster.`;
    console.error(`[draft] league ${leagueId} — auto-draft stalled: ${msg}`);
    io.to(`draft:${leagueId}`).emit('draft:error', msg);
  }

  await startPickTimer(io, leagueId);
}

async function scheduledDraftStart(io: Server, leagueId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { teams: { orderBy: { draftPosition: 'asc' } } },
  });
  if (!league || league.status !== 'pending' || league.teams.length < 2) return;

  const teamIds = league.teams.map((t) => t.id);
  const pickOrder: string[] = [];
  for (let round = 0; round < ALL_SLOTS.length; round++) {
    const roundTeams = round % 2 === 0 ? teamIds : [...teamIds].reverse();
    pickOrder.push(...roundTeams);
  }

  const countdownEndsAt = new Date(Date.now() + 10 * 60_000);

  await prisma.$transaction([
    prisma.league.update({ where: { id: leagueId }, data: { status: 'pre_draft', draftTime: countdownEndsAt } }),
    prisma.draftState.upsert({
      where: { leagueId },
      create: { leagueId, currentPick: 0, pickOrder, timerEndsAt: null },
      update: { currentPick: 0, pickOrder, timerEndsAt: null, isComplete: false },
    }),
  ]);

  const updated = await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      teams: { include: { user: { select: { username: true, avatarUrl: true } } }, orderBy: { draftPosition: 'asc' } },
      draftPicks: {
        include: {
          artist: { select: { id: true, name: true, primaryGenre: true, imageUrl: true } },
          team: { select: { id: true, name: true, logoUrl: true } },
        },
        orderBy: { pickNumber: 'asc' },
      },
    },
  });

  io.to(`draft:${leagueId}`).emit('draft:state', {
    status: 'pre_draft',
    currentPickIndex: 0,
    pickOrder,
    timerEndsAt: null,
    isComplete: false,
    teams: updated?.teams ?? [],
    picks: [],
    countdownEndsAt,
  });

  if (!countdownTimers.has(leagueId)) {
    const timeout = setTimeout(() => {
      countdownTimers.delete(leagueId);
      transitionToLiveDraft(io, leagueId).catch((err) => console.error('[draft] countdown transition failed:', err));
    }, 10 * 60_000);
    countdownTimers.set(leagueId, timeout);
  }
}

export function startDraftScheduler(io: Server) {
  setInterval(async () => {
    try {
      const overdue = await prisma.league.findMany({
        where: { status: 'pending', draftTime: { not: null, lte: new Date() } },
        select: { id: true },
      });
      for (const { id } of overdue) {
        await scheduledDraftStart(io, id);
      }
    } catch (err) {
      // Same reasoning as startPickTimer's tick guard: an uncaught throw
      // here (e.g. a transient DB error) would otherwise crash the whole
      // process on Node 15+, not just skip this poll.
      console.error('[draft] scheduler tick failed:', err);
    }
  }, 30_000);
}

export function registerDraftSocket(io: Server) {
  io.on('connection', (socket: Socket) => {
    let socketUserId: string | null = null;

    socket.on('draft:join', async ({ leagueId, token }: { leagueId: string; token: string }) => {
      try {
        socketUserId = await verifyActiveUser(token);

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
              transitionToLiveDraft(io, leagueId).catch((err) => console.error('[draft] countdown transition failed:', err));
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
        const userId = await verifyActiveUser(token);
        const league = await prisma.league.findUnique({ where: { id: leagueId } });
        if (!league) { socket.emit('draft:error', 'League not found'); return; }
        if (league.commissionerId !== userId) {
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
        const userId = await verifyActiveUser(token);

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
          triggerInitialScoring(leagueId).catch((err) =>
            console.error('[draft] initial scoring error:', err),
          );
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
