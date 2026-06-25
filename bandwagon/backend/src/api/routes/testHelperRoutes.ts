import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma';
import { signToken } from '../middleware/auth';
import { generateInviteCode } from './leagues';

const router = Router();

const ALL_SLOTS = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Other', 'Flex', 'Bench-1', 'Bench-2', 'Bench-3'];

// Creates two users + an active league with full rosters and a week-1 matchup.
// Returns credentials so E2E tests can exercise lineup/matchup features without running a full draft.
router.post('/active-league', async (req, res, next) => {
  try {
    const ts = Date.now();
    const hash = await bcrypt.hash('testpass123', 10);

    const [user1, user2] = await Promise.all([
      prisma.user.create({
        data: {
          email: `e2e-u1-${ts}@test.internal`,
          passwordHash: hash,
          username: `e2eu1${ts}`,
        },
      }),
      prisma.user.create({
        data: {
          email: `e2e-u2-${ts}@test.internal`,
          passwordHash: hash,
          username: `e2eu2${ts}`,
        },
      }),
    ]);

    let inviteCode = generateInviteCode();
    while (await prisma.league.findUnique({ where: { inviteCode } })) {
      inviteCode = generateInviteCode();
    }

    const league = await prisma.league.create({
      data: {
        name: `E2E League ${ts}`,
        commissionerId: user1.id,
        teamCount: 2,
        privacy: 'private',
        status: 'active',
        inviteCode,
        currentWeek: 1,
        seasonYear: 2026,
        draftTime: new Date(Date.now() - 14 * 24 * 60 * 60_000),
      },
    });

    const [team1, team2] = await Promise.all([
      prisma.team.create({
        data: { leagueId: league.id, userId: user1.id, name: `E2E Team A`, draftPosition: 1 },
      }),
      prisma.team.create({
        data: { leagueId: league.id, userId: user2.id, name: `E2E Team B`, draftPosition: 2 },
      }),
    ]);

    // Fetch artists for roster slots
    const [rbhArtists, popArtists, rockArtists, countryArtists, otherArtists] = await Promise.all([
      prisma.artist.findMany({ where: { primaryGenre: 'R&B/Hip-Hop' }, take: 5 }),
      prisma.artist.findMany({ where: { primaryGenre: 'Pop' }, take: 6 }),
      prisma.artist.findMany({ where: { primaryGenre: 'Rock & Alternative' }, take: 2 }),
      prisma.artist.findMany({ where: { primaryGenre: 'Country' }, take: 3 }),
      prisma.artist.findMany({ where: { primaryGenre: { in: ['Latin', 'Dance', 'K-Pop', 'Afrobeats', 'Other'] } }, take: 2 }),
    ]);

    if (rbhArtists.length < 5 || popArtists.length < 6 || rockArtists.length < 2 || countryArtists.length < 3 || otherArtists.length < 2) {
      res.status(500).json({ error: 'Insufficient artists in test DB — run e2eSeed first.' });
      return;
    }

    const team1Roster = [
      { slot: 'R&B/Hip-Hop', artistId: rbhArtists[0].id },
      { slot: 'Pop', artistId: popArtists[0].id },
      { slot: 'Rock & Alternative', artistId: rockArtists[0].id },
      { slot: 'Country', artistId: countryArtists[0].id },
      { slot: 'Other', artistId: otherArtists[0].id },
      { slot: 'Flex', artistId: rbhArtists[1].id },
      { slot: 'Bench-1', artistId: popArtists[1].id },
      { slot: 'Bench-2', artistId: rbhArtists[2].id },
      { slot: 'Bench-3', artistId: popArtists[2].id },
    ];

    const team2Roster = [
      { slot: 'R&B/Hip-Hop', artistId: rbhArtists[3].id },
      { slot: 'Pop', artistId: popArtists[3].id },
      { slot: 'Rock & Alternative', artistId: rockArtists[1].id },
      { slot: 'Country', artistId: countryArtists[1].id },
      { slot: 'Other', artistId: otherArtists[1].id },
      { slot: 'Flex', artistId: popArtists[4].id },
      { slot: 'Bench-1', artistId: rbhArtists[4].id },
      { slot: 'Bench-2', artistId: popArtists[5].id },
      { slot: 'Bench-3', artistId: countryArtists[2].id },
    ];

    // Also create empty slots for remaining ALL_SLOTS that won't be in the rosters above
    const allSlotSet = new Set(ALL_SLOTS);
    const team1Used = new Set(team1Roster.map((r) => r.slot));
    const team2Used = new Set(team2Roster.map((r) => r.slot));

    await Promise.all([
      ...team1Roster.map((r) => prisma.rosterSpot.create({ data: { teamId: team1.id, slot: r.slot, artistId: r.artistId } })),
      ...[...allSlotSet].filter((s) => !team1Used.has(s)).map((s) =>
        prisma.rosterSpot.create({ data: { teamId: team1.id, slot: s, artistId: null } })
      ),
      ...team2Roster.map((r) => prisma.rosterSpot.create({ data: { teamId: team2.id, slot: r.slot, artistId: r.artistId } })),
      ...[...allSlotSet].filter((s) => !team2Used.has(s)).map((s) =>
        prisma.rosterSpot.create({ data: { teamId: team2.id, slot: s, artistId: null } })
      ),
    ]);

    await prisma.matchup.create({
      data: {
        leagueId: league.id,
        week: 1,
        homeTeamId: team1.id,
        awayTeamId: team2.id,
        homeScore: 42.5,
        awayScore: 38.0,
        isFinalized: false,
      },
    });

    const [token1, token2] = [signToken(user1.id), signToken(user2.id)];

    res.json({
      user1: { id: user1.id, email: user1.email, token: token1 },
      user2: { id: user2.id, email: user2.email, token: token2 },
      leagueId: league.id,
      team1Id: team1.id,
      team2Id: team2.id,
    });
  } catch (err) {
    next(err);
  }
});

// Tears down a test league and its users. Pass user IDs to also delete the accounts.
router.delete('/cleanup', async (req, res, next) => {
  try {
    const { leagueId, userIds } = req.body as { leagueId?: string; userIds?: string[] };
    if (leagueId) {
      await prisma.league.deleteMany({ where: { id: leagueId } });
    }
    if (userIds?.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
