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

const router = Router();

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const CreateLeagueSchema = z.object({
  name: z.string().min(1).max(50),
  teamCount: z.number().int().min(4).max(12).default(8),
  privacy: z.enum(['private', 'public']).default('private'),
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
          privacy: team.league.privacy,
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
        privacy: data.privacy,
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
      where: { privacy: 'public', status: 'pending' },
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
      privacy: z.enum(['private', 'public']).optional(),
      draftTime: z.string().datetime().optional().nullable(),
      scoringConfig: ScoringConfigSchema.optional().nullable(),
    });
    const data = schema.parse(req.body);

    const settingsLocked = league.status !== 'pending';
    const scoringLocked = league.status !== 'pending' && league.status !== 'complete';

    if (settingsLocked && (data.name !== undefined || data.draftTime !== undefined || data.teamCount !== undefined || data.privacy !== undefined)) {
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
        ...(data.privacy && { privacy: data.privacy }),
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
      orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }],
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
    })));
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
                      where: { week: league.currentWeek, seasonYear: league.seasonYear },
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
                      where: { week: league.currentWeek, seasonYear: league.seasonYear },
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

// All matchups for the league
router.get('/:id/matchups', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const matchups = await prisma.matchup.findMany({
      where: { leagueId: req.params.id },
      include: {
        homeTeam: { select: { id: true, name: true, logoUrl: true } },
        awayTeam: { select: { id: true, name: true, logoUrl: true } },
      },
      orderBy: { week: 'asc' },
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

    const [artists, leagueRow] = await Promise.all([
      prisma.artist.findMany({
        where: {
          ...(q && { name: { contains: q, mode: 'insensitive' } }),
          ...(genre && { primaryGenre: genre }),
        },
        include: {
          rosterSpots: {
            where: { team: { leagueId: req.params.id } },
            include: { team: { select: { id: true, name: true } } },
          },
          weeklyScores: {
            orderBy: { week: 'desc' },
            take: 5,
          },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.league.findUnique({ where: { id: req.params.id }, select: { scoringConfig: true } }),
    ]);

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
                weeklyScores: { where: { week: league.currentWeek, seasonYear: league.seasonYear } },
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

    // Validate eligibility: if moving to a non-Bench, non-Flex slot, genre must match
    const MAIN_GENRES = new Set(['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country']);
    function slotGenre(slot: string) {
      if (slot.startsWith('Bench') || slot === 'Flex') return null;
      return slot;
    }
    function artistEligibleForSlot(genre: string | null, slot: string): boolean {
      const required = slotGenre(slot);
      if (!required) return true;
      if (required === 'Other') return genre !== null && !MAIN_GENRES.has(genre);
      return genre === required;
    }

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

// POST /api/leagues/:id/roster/claim — pick up a free agent, dropping one of your own artists
router.post('/:id/roster/claim', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({ artistId: z.string(), dropSlot: z.string() });
    const { artistId, dropSlot } = schema.parse(req.body);

    const league = await prisma.league.findUnique({
      where: { id: req.params.id },
      include: { teams: true },
    });
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }

    const myTeam = league.teams.find((t) => t.userId === req.userId);
    if (!myTeam) { res.status(403).json({ error: 'You are not in this league' }); return; }

    if (league.status !== 'active') {
      res.status(400).json({ error: 'Free agent claims are only available during the active season' });
      return;
    }

    const artist = await prisma.artist.findUnique({ where: { id: artistId } });
    if (!artist) { res.status(404).json({ error: 'Artist not found' }); return; }

    // Confirm artist is a free agent (no roster spot with this artistId in this league)
    const rostered = await prisma.rosterSpot.findFirst({
      where: { artistId, team: { leagueId: req.params.id } },
    });
    if (rostered) { res.status(400).json({ error: `${artist.name} is already on a roster` }); return; }

    // Confirm the drop slot exists on user's team and has a player
    const dropSpot = await prisma.rosterSpot.findUnique({
      where: { teamId_slot: { teamId: myTeam.id, slot: dropSlot } },
      include: { artist: true },
    });
    if (!dropSpot) { res.status(400).json({ error: 'Invalid slot' }); return; }
    if (!dropSpot.artistId) { res.status(400).json({ error: 'That slot is already empty' }); return; }

    // Confirm new artist is eligible for the slot being freed
    const MAIN_GENRES = new Set(['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country']);
    function eligibleForSlot(genre: string, slot: string): boolean {
      if (slot.startsWith('Bench') || slot === 'Flex') return true;
      if (slot === 'Other') return !MAIN_GENRES.has(genre);
      return genre === slot;
    }
    if (!eligibleForSlot(artist.primaryGenre, dropSlot)) {
      res.status(400).json({ error: `${artist.name} is not eligible for the ${dropSlot} slot` });
      return;
    }

    const droppedArtistId = dropSpot.artistId;

    await prisma.rosterSpot.update({
      where: { id: dropSpot.id },
      data: { artistId },
    });

    res.json({ success: true, slot: dropSlot, droppedArtistId, addedArtistId: artistId });
  } catch (err) {
    next(err);
  }
});

export default router;
