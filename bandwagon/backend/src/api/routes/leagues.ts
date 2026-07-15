import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { uploadTeamLogo } from '../middleware/upload';
import { ScoringConfigSchema } from '../../scoring/tiers';
import { applyCustomScoringToWeeklyScore } from '../../scoring/engine';
import { buildWeek11Matchups } from '../../playoffs/bracket';
import { logLeagueEvent } from '../../events/leagueEvents';
import { weekDateForLeagueWeek } from '../../scoring/engine';
import { getCurrentWeekDate } from '../../jobs/ingestCharts';
// Circular with waivers/engine (which imports artistEligibleForSlot from here,
// as does trades/engine); safe because both sides only reference the other's
// exports at call time.
import { submitWaiverClaim, cancelWaiverClaim, reorderWaiverClaims } from '../../waivers/engine';
import { renewLeague } from '../../season/rollover';

const router = Router();

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export const MAIN_GENRES = new Set(['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country']);

// "Other" in a genre filter means the Other-slot bucket (any non-main genre),
// matching artistEligibleForSlot — not artists literally tagged "Other".
export function genreFilterToWhere(genre: string): { primaryGenre: string | { notIn: string[] } } {
  return { primaryGenre: genre === 'Other' ? { notIn: [...MAIN_GENRES] } : genre };
}

export function artistEligibleForSlot(genre: string | null, slot: string): boolean {
  if (slot.startsWith('Bench') || slot === 'Flex') return true;
  if (slot === 'Other') return genre !== null && !MAIN_GENRES.has(genre);
  return genre === slot;
}

const CreateLeagueSchema = z.object({
  name: z.string().min(1).max(50),
  teamCount: z.number().int().min(4).max(12).default(8),
  isPrivate: z.boolean().default(true),
  draftTime: z.string().datetime(),
});

// Get user's leagues
router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const teams = await prisma.team.findMany({
      where: { userId: req.userId! },
      include: {
        league: {
          include: {
            teams: {
              include: { user: { select: { username: true, avatarUrl: true } } },
            },
          },
        },
      },
    });

    const leagues = await Promise.all(
      teams.map(async (team) => {
        const currentWeek = team.league.currentWeek;
        const matchup = await prisma.matchup.findFirst({
          where: { leagueId: team.leagueId, week: currentWeek },
          include: {
            homeTeam: { select: { id: true, name: true, logoUrl: true } },
            awayTeam: { select: { id: true, name: true, logoUrl: true } },
          },
        });

        let opponent = null;
        let myScore = 0;
        let opponentScore = 0;
        if (matchup) {
          const iHome = matchup.homeTeamId === team.id;
          opponent = iHome ? matchup.awayTeam : matchup.homeTeam;
          myScore = iHome ? matchup.homeScore : matchup.awayScore;
          opponentScore = iHome ? matchup.awayScore : matchup.homeScore;
        }

        return {
          id: team.league.id,
          name: team.league.name,
          status: team.league.status,
          currentWeek,
          isPrivate: team.league.isPrivate,
          teamCount: team.league.teamCount,
          isCommissioner: team.league.commissionerId === req.userId,
          myTeam: { id: team.id, name: team.name, logoUrl: team.logoUrl, wins: team.wins, losses: team.losses },
          opponent,
          myScore,
          opponentScore,
          memberCount: team.league.teams.length,
        };
      })
    );

    res.json(leagues);
  } catch (err) {
    next(err);
  }
});

// Create league
router.post('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const data = CreateLeagueSchema.parse(req.body);
    const minAllowed = new Date(Date.now() + 60 * 60_000);
    if (new Date(data.draftTime) < minAllowed) {
      res.status(400).json({ error: 'Draft time must be at least 1 hour from now' });
      return;
    }
    let inviteCode = generateInviteCode();
    // Ensure unique
    while (await prisma.league.findUnique({ where: { inviteCode } })) {
      inviteCode = generateInviteCode();
    }

    const league = await prisma.league.create({
      data: {
        name: data.name,
        commissionerId: req.userId!,
        teamCount: data.teamCount,
        isPrivate: data.isPrivate,
        draftTime: data.draftTime ? new Date(data.draftTime) : null,
        inviteCode,
        status: 'pending',
      },
    });

    // Auto-create a team for the commissioner
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    await prisma.team.create({
      data: {
        leagueId: league.id,
        userId: req.userId!,
        name: `${user?.username ?? 'Team'}'s Squad`,
        draftPosition: 1,
        waiverPriority: 1,
      },
    });

    res.status(201).json({ ...league, inviteUrl: `${req.headers.origin || 'http://localhost:5173'}/leagues/join/${inviteCode}` });
  } catch (err) {
    next(err);
  }
});

// List open public leagues
router.get('/public', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const leagues = await prisma.league.findMany({
      where: { isPrivate: false, status: 'pending' },
      include: {
        teams: { select: { id: true } },
        commissioner: { select: { username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const open = leagues
      .filter((l) => l.teams.length < l.teamCount)
      .map((l) => ({
        id: l.id,
        name: l.name,
        commissionerName: l.commissioner.username,
        memberCount: l.teams.length,
        teamCount: l.teamCount,
        draftTime: l.draftTime,
        inviteCode: l.inviteCode,
      }));

    res.json(open);
  } catch (err) {
    next(err);
  }
});

// Get single league
router.get('/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const league = await prisma.league.findUnique({
      where: { id: req.params.id },
      include: {
        teams: {
          include: { user: { select: { id: true, username: true, avatarUrl: true } } },
          orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }],
        },
        commissioner: { select: { id: true, username: true } },
      },
    });
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }

    const isMember = league.teams.some((t) => t.userId === req.userId);
    if (!isMember) { res.status(403).json({ error: 'Not a member of this league' }); return; }

    res.json(league);
  } catch (err) {
    next(err);
  }
});

// Update league settings (commissioner only)
router.put('/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const league = await prisma.league.findUnique({ where: { id: req.params.id } });
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }
    if (league.commissionerId !== req.userId) { res.status(403).json({ error: 'Only the commissioner can edit settings' }); return; }

    const schema = z.object({
      name: z.string().min(1).max(50).optional(),
      teamCount: z.number().int().min(4).max(12).optional(),
      isPrivate: z.boolean().optional(),
      draftTime: z.string().datetime().optional().nullable(),
      scoringConfig: ScoringConfigSchema.optional().nullable(),
    });
    const data = schema.parse(req.body);

    const settingsLocked = league.status !== 'pending';
    const scoringLocked = league.status !== 'pending' && league.status !== 'complete';

    if (settingsLocked && (data.name !== undefined || data.draftTime !== undefined || data.teamCount !== undefined || data.isPrivate !== undefined)) {
      res.status(400).json({ error: 'League settings are locked once the season starts' });
      return;
    }

    if (data.draftTime) {
      const minAllowed = new Date(Date.now() + 60 * 60_000);
      if (new Date(data.draftTime) < minAllowed) {
        res.status(400).json({ error: 'Draft time must be at least 1 hour from now' });
        return;
      }
    }
    if (scoringLocked && data.scoringConfig !== undefined) {
      res.status(400).json({ error: 'Scoring settings can only be changed pre-draft or between seasons' });
      return;
    }

    const updated = await prisma.league.update({
      where: { id: req.params.id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.teamCount && { teamCount: data.teamCount }),
        ...(data.isPrivate !== undefined && { isPrivate: data.isPrivate }),
        ...(data.draftTime !== undefined && { draftTime: data.draftTime ? new Date(data.draftTime) : null }),
        ...(data.scoringConfig !== undefined && { scoringConfig: data.scoringConfig ?? Prisma.DbNull }),
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Delete league (commissioner only)
router.delete('/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const league = await prisma.league.findUnique({
      where: { id: req.params.id },
      include: { teams: { include: { user: { select: { id: true } } } } },
    });
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }
    if (league.commissionerId !== req.userId) {
      res.status(403).json({ error: 'Only the commissioner can delete this league' });
      return;
    }

    const memberIds = league.teams
      .map((t) => t.userId)
      .filter((id) => id !== req.userId);

    if (memberIds.length > 0) {
      await prisma.notification.createMany({
        data: memberIds.map((userId) => ({
          userId,
          type: 'league_deleted',
          message: `The league "${league.name}" was deleted by the commissioner.`,
        })),
      });
    }

    await prisma.league.delete({ where: { id: req.params.id } });
    res.json({ message: 'League deleted' });
  } catch (err) {
    next(err);
  }
});

// Renew a completed league for a new season (commissioner only).
router.post('/:id/renew', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { draftTime } = z.object({ draftTime: z.string().datetime() }).parse(req.body);
    const result = await renewLeague(req.params.id, req.userId!, draftTime);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Leave league
router.post('/:id/leave', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const league = await prisma.league.findUnique({
      where: { id: req.params.id },
      include: { teams: { where: { userId: req.userId! } } },
    });
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }
    if (league.commissionerId === req.userId) {
      res.status(400).json({ error: 'Commissioners cannot leave their own league. Delete the league instead.' });
      return;
    }
    const team = league.teams[0];
    if (!team) { res.status(400).json({ error: 'You are not a member of this league' }); return; }
    if (league.status !== 'pending') {
      res.status(400).json({ error: 'You cannot leave a league after the draft has started' });
      return;
    }
    await prisma.team.delete({ where: { id: team.id } });
    res.json({ message: 'Left league' });
  } catch (err) {
    next(err);
  }
});

// Join league by invite code
router.post('/join/:code', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const league = await prisma.league.findUnique({
      where: { inviteCode: req.params.code },
      include: { teams: true },
    });
    if (!league) { res.status(404).json({ error: 'Invalid invite code' }); return; }
    if (league.status !== 'pending') { res.status(400).json({ error: 'This league has already started' }); return; }
    if (league.teams.length >= league.teamCount) { res.status(400).json({ error: 'This league is full' }); return; }

    const already = league.teams.find((t) => t.userId === req.userId);
    if (already) { res.json({ league, team: already }); return; }

    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    const team = await prisma.team.create({
      data: {
        leagueId: league.id,
        userId: req.userId!,
        name: `${user?.username ?? 'Team'}'s Squad`,
        draftPosition: league.teams.length + 1,
        waiverPriority: league.teams.length + 1,
      },
    });

    await logLeagueEvent(
      prisma,
      league.id,
      'member_joined',
      `${user?.username ?? 'A new member'} joined the league as ${team.name}`,
    );

    res.status(201).json({ league, team });
  } catch (err) {
    next(err);
  }
});

// Get league invite info (public, no auth required for joining flow)
router.get('/invite/:code', async (req, res, next) => {
  try {
    const league = await prisma.league.findUnique({
      where: { inviteCode: req.params.code },
      include: { teams: true, commissioner: { select: { username: true } } },
    });
    if (!league) { res.status(404).json({ error: 'Invalid invite code' }); return; }
    res.json({
      id: league.id,
      name: league.name,
      commissionerName: league.commissioner.username,
      memberCount: league.teams.length,
      teamCount: league.teamCount,
      status: league.status,
    });
  } catch (err) {
    next(err);
  }
});

// Standings
router.get('/:id/standings', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const league = await prisma.league.findUnique({ where: { id: req.params.id } });
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }

    const teams = await prisma.team.findMany({
      where: { leagueId: req.params.id },
      include: { user: { select: { username: true, avatarUrl: true } } },
      // Same order as playoff seeding (getFinalSeeds), so rank always matches seed
      orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }, { createdAt: 'asc' }],
    });

    res.json(teams.map((t, i) => ({
      rank: i + 1,
      teamId: t.id,
      teamName: t.name,
      teamLogoUrl: t.logoUrl,
      userId: t.userId,
      username: t.user.username,
      avatarUrl: t.user.avatarUrl,
      wins: t.wins,
      losses: t.losses,
      pointsFor: t.pointsFor,
      waiverPriority: t.waiverPriority,
    })));
  } catch (err) {
    next(err);
  }
});

// Activity feed: league-wide events merged with the requesting user's
// league-scoped personal notifications, newest first.
router.get('/:id/activity', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const leagueId = req.params.id;
    const league = await prisma.league.findUnique({ where: { id: leagueId } });
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }
    const myTeam = await prisma.team.findFirst({ where: { leagueId, userId: req.userId! } });
    if (!myTeam) { res.status(403).json({ error: 'You are not a member of this league' }); return; }

    const [events, personal, unseenCount] = await Promise.all([
      prisma.leagueEvent.findMany({
        where: { leagueId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.notification.findMany({
        where: { userId: req.userId!, leagueId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.notification.count({
        where: { userId: req.userId!, leagueId, seenAt: null },
      }),
    ]);

    const items = [
      ...events.map((e) => ({
        id: e.id,
        kind: 'league' as const,
        type: e.type,
        message: e.message,
        meta: e.meta,
        createdAt: e.createdAt,
      })),
      ...personal.map((n) => ({
        id: n.id,
        kind: 'personal' as const,
        type: n.type,
        message: n.message,
        seenAt: n.seenAt,
        createdAt: n.createdAt,
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 100);

    res.json({ items, unseenCount });
  } catch (err) {
    next(err);
  }
});

// Mark all of the user's league-scoped notifications seen (badge reset).
router.post('/:id/notifications/seen', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const leagueId = req.params.id;
    const myTeam = await prisma.team.findFirst({ where: { leagueId, userId: req.userId! } });
    if (!myTeam) { res.status(403).json({ error: 'You are not a member of this league' }); return; }

    const { count } = await prisma.notification.updateMany({
      where: { userId: req.userId!, leagueId, seenAt: null },
      data: { seenAt: new Date() },
    });
    res.json({ ok: true, count });
  } catch (err) {
    next(err);
  }
});

// Playoff bracket: the real playoff matchups once they exist, otherwise a
// projection from current standings ("if the season ended today"). Returns
// null when the league is too small for playoffs (< 4 teams).
router.get('/:id/bracket', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const leagueId = req.params.id;
    const league = await prisma.league.findUnique({ where: { id: leagueId } });
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }

    const teamInclude = { select: { id: true, name: true, wins: true, losses: true } };
    const actual = await prisma.matchup.findMany({
      where: { leagueId, week: { gt: 10 }, matchupType: { not: 'regular' } },
      include: { homeTeam: teamInclude, awayTeam: teamInclude },
      orderBy: [{ week: 'asc' }, { homeSeed: 'asc' }],
    });
    if (actual.length > 0) {
      res.json({ projected: false, matchups: actual });
      return;
    }

    const teams = await prisma.team.findMany({
      where: { leagueId },
      select: { id: true, name: true, wins: true, losses: true },
      orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }, { createdAt: 'asc' }],
    });
    if (teams.length < 4) { res.json(null); return; }

    const seeds = teams.map((t, i) => ({ teamId: t.id, seed: i + 1 }));
    const teamById = new Map(teams.map((t) => [t.id, t]));
    const projected = buildWeek11Matchups(leagueId, seeds).map((m, i) => ({
      id: `projected-${i}`,
      leagueId,
      week: m.week,
      matchupType: m.matchupType,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      homeSeed: m.homeSeed,
      awaySeed: m.awaySeed,
      homeScore: 0,
      awayScore: 0,
      winnerId: null,
      isFinalized: false,
      homeTeam: teamById.get(m.homeTeamId)!,
      awayTeam: teamById.get(m.awayTeamId)!,
    }));
    res.json({ projected: true, matchups: projected });
  } catch (err) {
    next(err);
  }
});

// Any week matchup for the requesting user
router.get('/:id/matchups/week/:week', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const week = parseInt(req.params.week, 10);
    if (isNaN(week) || week < 1) { res.status(400).json({ error: 'Invalid week' }); return; }

    const league = await prisma.league.findUnique({ where: { id: req.params.id } });
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }

    const myTeam = await prisma.team.findFirst({
      where: { leagueId: req.params.id, userId: req.userId! },
    });
    if (!myTeam) { res.status(403).json({ error: 'Not a member' }); return; }

    const matchup = await prisma.matchup.findFirst({
      where: {
        leagueId: req.params.id,
        week,
        OR: [{ homeTeamId: myTeam.id }, { awayTeamId: myTeam.id }],
      },
      include: {
        homeTeam: {
          include: {
            user: { select: { username: true, avatarUrl: true } },
            rosterSpots: {
              include: {
                artist: {
                  include: {
                    weeklyScores: {
                      where: { weekDate: weekDateForLeagueWeek(league.currentWeek, week) },
                    },
                  },
                },
              },
            },
          },
        },
        awayTeam: {
          include: {
            user: { select: { username: true, avatarUrl: true } },
            rosterSpots: {
              include: {
                artist: {
                  include: {
                    weeklyScores: {
                      where: { weekDate: weekDateForLeagueWeek(league.currentWeek, week) },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!matchup) { res.json(null); return; }
    res.json(matchup);
  } catch (err) {
    next(err);
  }
});

// Current week matchup for the requesting user
router.get('/:id/matchups/current', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const league = await prisma.league.findUnique({ where: { id: req.params.id } });
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }

    const myTeam = await prisma.team.findFirst({
      where: { leagueId: req.params.id, userId: req.userId! },
    });
    if (!myTeam) { res.status(403).json({ error: 'Not a member' }); return; }

    const matchup = await prisma.matchup.findFirst({
      where: {
        leagueId: req.params.id,
        week: league.currentWeek,
        OR: [{ homeTeamId: myTeam.id }, { awayTeamId: myTeam.id }],
      },
      include: {
        homeTeam: {
          include: {
            user: { select: { username: true, avatarUrl: true } },
            rosterSpots: {
              include: {
                artist: {
                  include: {
                    weeklyScores: {
                      where: { weekDate: getCurrentWeekDate() },
                    },
                  },
                },
              },
            },
          },
        },
        awayTeam: {
          include: {
            user: { select: { username: true, avatarUrl: true } },
            rosterSpots: {
              include: {
                artist: {
                  include: {
                    weeklyScores: {
                      where: { weekDate: getCurrentWeekDate() },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!matchup) { res.json(null); return; }
    res.json(matchup);
  } catch (err) {
    next(err);
  }
});

// Previous week matchup for the requesting user (for win/loss popup + prev-score reference)
router.get('/:id/matchups/previous', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const league = await prisma.league.findUnique({ where: { id: req.params.id } });
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }
    if (league.currentWeek <= 1) { res.json(null); return; }

    const myTeam = await prisma.team.findFirst({
      where: { leagueId: req.params.id, userId: req.userId! },
    });
    if (!myTeam) { res.status(403).json({ error: 'Not a member' }); return; }

    const prevWeek = league.currentWeek - 1;
    const matchup = await prisma.matchup.findFirst({
      where: {
        leagueId: req.params.id,
        week: prevWeek,
        OR: [{ homeTeamId: myTeam.id }, { awayTeamId: myTeam.id }],
      },
      include: {
        homeTeam: {
          include: {
            user: { select: { username: true, avatarUrl: true } },
            rosterSpots: {
              include: {
                artist: {
                  include: {
                    weeklyScores: {
                      where: { weekDate: weekDateForLeagueWeek(league.currentWeek, prevWeek) },
                    },
                  },
                },
              },
            },
          },
        },
        awayTeam: {
          include: {
            user: { select: { username: true, avatarUrl: true } },
            rosterSpots: {
              include: {
                artist: {
                  include: {
                    weeklyScores: {
                      where: { weekDate: weekDateForLeagueWeek(league.currentWeek, prevWeek) },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    res.json(matchup ?? null);
  } catch (err) {
    next(err);
  }
});

// Full detail (both rosters + that week's per-artist scores) for any one
// matchup in the league, so members can inspect games they're not in.
// Must be registered after /matchups/current and /matchups/previous —
// Express matches in registration order and :matchupId would swallow them.
router.get('/:id/matchups/:matchupId', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const league = await prisma.league.findUnique({ where: { id: req.params.id } });
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }

    const myTeam = await prisma.team.findFirst({
      where: { leagueId: req.params.id, userId: req.userId! },
    });
    if (!myTeam) { res.status(403).json({ error: 'Not a member' }); return; }

    // Two-step: the weeklyScores filter needs the matchup's week.
    const base = await prisma.matchup.findFirst({
      where: { id: req.params.matchupId, leagueId: req.params.id },
    });
    if (!base) { res.status(404).json({ error: 'Matchup not found' }); return; }

    const rosterInclude = {
      user: { select: { username: true, avatarUrl: true } },
      rosterSpots: {
        include: {
          artist: {
            include: {
              weeklyScores: {
                where: { weekDate: weekDateForLeagueWeek(league.currentWeek, base.week) },
              },
            },
          },
        },
      },
    };
    const matchup = await prisma.matchup.findUnique({
      where: { id: base.id },
      include: { homeTeam: { include: rosterInclude }, awayTeam: { include: rosterInclude } },
    });
    res.json(matchup);
  } catch (err) {
    next(err);
  }
});

// All matchups for the league; ?week=N narrows to a single week
router.get('/:id/matchups', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const week = req.query.week ? parseInt(req.query.week as string, 10) : undefined;
    const matchups = await prisma.matchup.findMany({
      where: {
        leagueId: req.params.id,
        ...(week !== undefined && !isNaN(week) && { week }),
      },
      include: {
        homeTeam: { select: { id: true, name: true, logoUrl: true } },
        awayTeam: { select: { id: true, name: true, logoUrl: true } },
      },
      orderBy: [{ week: 'asc' }, { homeSeed: 'asc' }],
    });
    res.json(matchups);
  } catch (err) {
    next(err);
  }
});

// Players list (all artists with rostered-by info for this league)
router.get('/:id/players', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const q = (req.query.q as string) || '';
    const genre = req.query.genre as string | undefined;

    const leagueRow = await prisma.league.findUnique({
      where: { id: req.params.id },
      select: { scoringConfig: true, currentWeek: true, seasonYear: true },
    });

    const artists = await prisma.artist.findMany({
      where: {
        hiddenAt: null, // retired combined credits stay out of the player pool
        ...(q && { name: { contains: q, mode: 'insensitive' } }),
        ...(genre && genreFilterToWhere(genre)),
      },
      include: {
        rosterSpots: {
          where: { team: { leagueId: req.params.id } },
          include: { team: { select: { id: true, name: true } } },
        },
        weeklyScores: {
          where: { weekDate: { lte: getCurrentWeekDate() } },
          orderBy: { weekDate: 'desc' },
          take: 5,
        },
      },
      orderBy: { name: 'asc' },
    });

    const cfg = ScoringConfigSchema.safeParse(leagueRow?.scoringConfig).data ?? null;

    // Pre-fetch genre tiers for all distinct genres if custom config is set
    const genreTierCache = new Map<string, Awaited<ReturnType<typeof prisma.genreStreamingTier.findMany>>>();
    if (cfg) {
      const genres = [...new Set(artists.map((a) => a.primaryGenre))];
      await Promise.all(
        genres.map(async (g) => {
          const rows = await prisma.genreStreamingTier.findMany({ where: { genre: g }, orderBy: { sortOrder: 'asc' } });
          genreTierCache.set(g, rows.length ? rows : await prisma.genreStreamingTier.findMany({ where: { genre: 'Pop' }, orderBy: { sortOrder: 'asc' } }));
        })
      );
    }

    res.json(
      artists.map((a) => {
        if (!cfg) {
          return {
            id: a.id,
            name: a.name,
            primaryGenre: a.primaryGenre,
            imageUrl: a.imageUrl,
            rosteredBy: a.rosterSpots[0]?.team ?? null,
            lastWeekPoints: a.weeklyScores[0]?.totalPoints ?? 0,
            avgLast5Points: a.weeklyScores.length > 0
              ? a.weeklyScores.reduce((s, w) => s + w.totalPoints, 0) / a.weeklyScores.length
              : 0,
          };
        }

        const genreTiers = genreTierCache.get(a.primaryGenre) ?? [];
        const adjustedScores = a.weeklyScores.map((ws) =>
          applyCustomScoringToWeeklyScore(ws, a.primaryGenre, genreTiers, cfg).totalPoints
        );

        return {
          id: a.id,
          name: a.name,
          primaryGenre: a.primaryGenre,
          imageUrl: a.imageUrl,
          rosteredBy: a.rosterSpots[0]?.team ?? null,
          lastWeekPoints: adjustedScores[0] ?? 0,
          avgLast5Points: adjustedScores.length > 0
            ? adjustedScores.reduce((s, p) => s + p, 0) / adjustedScores.length
            : 0,
        };
      })
    );
  } catch (err) {
    next(err);
  }
});

// My team's roster (used by the My Team tab to view/edit lineup independent of a matchup)
router.get('/:id/roster', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const league = await prisma.league.findUnique({ where: { id: req.params.id } });
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }

    const myTeam = await prisma.team.findFirst({
      where: { leagueId: req.params.id, userId: req.userId! },
      include: {
        rosterSpots: {
          include: {
            artist: {
              include: {
                weeklyScores: { where: { weekDate: getCurrentWeekDate() } },
              },
            },
          },
        },
      },
    });
    if (!myTeam) { res.status(403).json({ error: 'Not a member' }); return; }

    res.json(myTeam);
  } catch (err) {
    next(err);
  }
});

// Update my team's name/logo within this league (distinct from the account username/picture)
router.put('/:id/team', requireAuth, uploadTeamLogo, async (req: AuthRequest, res, next) => {
  try {
    const data = z.object({
      name: z.string().trim().min(1).max(30).optional(),
    }).parse(req.body);

    const myTeam = await prisma.team.findFirst({ where: { leagueId: req.params.id, userId: req.userId! } });
    if (!myTeam) { res.status(404).json({ error: 'Team not found' }); return; }

    const updateData: { name?: string; logoUrl?: string } = {};
    if (data.name) updateData.name = data.name;
    if (req.file) updateData.logoUrl = `/uploads/team-logos/${req.file.filename}`;

    if (Object.keys(updateData).length === 0) {
      res.json(myTeam);
      return;
    }

    const updated = await prisma.team.update({ where: { id: myTeam.id }, data: updateData });

    if (req.file && myTeam.logoUrl?.startsWith('/uploads/')) {
      const oldPath = path.join(__dirname, '../../../uploads', myTeam.logoUrl.slice('/uploads/'.length));
      fs.unlink(oldPath, (err) => {
        if (err && (err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Failed to delete old team logo:', err);
      });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Returns true if lineup edits are forbidden right now.
// dayPT: day-of-week name in Pacific time (e.g. 'Monday').
// todayPT: Pacific date string in 'YYYY-MM-DD' format.
export function isLineupLocked(
  dayPT: string,
  currentWeek: number,
  draftTime: Date | null,
  todayPT: string,
): boolean {
  if (dayPT === 'Monday') return false;

  if (currentWeek === 1 && draftTime) {
    const dowNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const draftDow = dowNames.indexOf(
      draftTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' }),
    );
    const daysToTuesday = draftDow === 2 ? 7 : (2 - draftDow + 7) % 7;
    const firstTuesdayApprox = new Date(draftTime);
    firstTuesdayApprox.setDate(draftTime.getDate() + daysToTuesday);
    const firstTuesdayPT = firstTuesdayApprox.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    if (todayPT < firstTuesdayPT) return false;
  }

  return true;
}

// Roster: swap lineup (starter ↔ bench)
router.put('/:id/roster/lineup', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      slotA: z.string(),
      slotB: z.string(),
    });
    const { slotA, slotB } = schema.parse(req.body);

    const league = await prisma.league.findUnique({ where: { id: req.params.id } });
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }

    // Enforce lineup lock: swaps only allowed on Monday (PT), or during the week-1 pre-game window
    if (league.status === 'active') {
      const dayPT = process.env.NODE_ENV === 'test' && process.env.TEST_OVERRIDE_DAY
        ? process.env.TEST_OVERRIDE_DAY
        : new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' });
      const todayPT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      if (isLineupLocked(dayPT, league.currentWeek, league.draftTime, todayPT)) {
        res.status(403).json({ error: 'Lineup is locked during the scoring week (Tuesday-Sunday).' });
        return;
      }
    }

    const myTeam = await prisma.team.findFirst({
      where: { leagueId: req.params.id, userId: req.userId! },
    });
    if (!myTeam) { res.status(403).json({ error: 'Not a member' }); return; }

    // Get both spots
    const [spotA, spotB] = await Promise.all([
      prisma.rosterSpot.findUnique({ where: { teamId_slot: { teamId: myTeam.id, slot: slotA } } }),
      prisma.rosterSpot.findUnique({ where: { teamId_slot: { teamId: myTeam.id, slot: slotB } } }),
    ]);

    if (!spotA || !spotB) { res.status(400).json({ error: 'Invalid slots' }); return; }

    // Fetch artist genres
    const [artistA, artistB] = await Promise.all([
      spotA.artistId ? prisma.artist.findUnique({ where: { id: spotA.artistId } }) : null,
      spotB.artistId ? prisma.artist.findUnique({ where: { id: spotB.artistId } }) : null,
    ]);

    if (artistA && !artistEligibleForSlot(artistA.primaryGenre, slotB)) {
      res.status(400).json({ error: `${artistA.name} is not eligible for the ${slotB} slot` });
      return;
    }
    if (artistB && !artistEligibleForSlot(artistB.primaryGenre, slotA)) {
      res.status(400).json({ error: `${artistB.name} is not eligible for the ${slotA} slot` });
      return;
    }

    // Perform the swap via temp null
    await prisma.$transaction([
      prisma.rosterSpot.update({ where: { id: spotA.id }, data: { artistId: null } }),
      prisma.rosterSpot.update({ where: { id: spotB.id }, data: { artistId: spotA.artistId } }),
      prisma.rosterSpot.update({ where: { id: spotA.id }, data: { artistId: spotB.artistId } }),
    ]);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:id/roster/claim — pick up a free agent. While the lineup
// is adjustable (Monday / week-1 pre-game window) the add is instant and free;
// otherwise it queues as a waiver claim resolved at the weekly finalize
// (Sunday night), highest waiver priority winning any conflicts.
router.post('/:id/roster/claim', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({ artistId: z.string(), dropSlot: z.string() });
    const { artistId, dropSlot } = schema.parse(req.body);
    const dayPT = process.env.NODE_ENV === 'test' && process.env.TEST_OVERRIDE_DAY
      ? process.env.TEST_OVERRIDE_DAY
      : new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' });
    const todayPT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const result = await submitWaiverClaim(req.params.id, req.userId!, artistId, dropSlot, dayPT, todayPT);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:id/waivers — the requesting user's pending claims + waiver position
router.get('/:id/waivers', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const leagueId = req.params.id;
    const myTeam = await prisma.team.findFirst({ where: { leagueId, userId: req.userId! } });
    if (!myTeam) { res.status(403).json({ error: 'You are not a member of this league' }); return; }

    const [teams, claims] = await Promise.all([
      prisma.team.findMany({
        where: { leagueId },
        select: { id: true },
        orderBy: [{ waiverPriority: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.waiverClaim.findMany({
        where: { teamId: myTeam.id, status: 'pending' },
        include: { artist: { select: { id: true, name: true, imageUrl: true, primaryGenre: true } } },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    const dropArtists = await prisma.artist.findMany({
      where: { id: { in: [...new Set(claims.map((c) => c.dropArtistId))] } },
      select: { id: true, name: true },
    });
    const dropName = new Map(dropArtists.map((a) => [a.id, a.name]));

    res.json({
      myTeamId: myTeam.id,
      waiverPosition: teams.findIndex((t) => t.id === myTeam.id) + 1,
      claims: claims.map((c) => ({
        id: c.id,
        dropSlot: c.dropSlot,
        createdAt: c.createdAt,
        artist: c.artist,
        dropArtist: { id: c.dropArtistId, name: dropName.get(c.dropArtistId) ?? 'Unknown' },
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/leagues/:id/waivers/order — reorder the user's pending claims
// (full list of claim ids in desired order; index 0 resolves first)
router.put('/:id/waivers/order', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { claimIds } = z.object({ claimIds: z.array(z.string()) }).parse(req.body);
    const result = await reorderWaiverClaims(req.params.id, req.userId!, claimIds);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:id/waivers/:claimId/cancel — withdraw a pending claim
router.post('/:id/waivers/:claimId/cancel', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const result = await cancelWaiverClaim(req.params.id, req.userId!, req.params.claimId);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
