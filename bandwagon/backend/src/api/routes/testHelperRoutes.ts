import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma';
import { signToken } from '../middleware/auth';
import { generateInviteCode } from './leagues';
import { buildRoundRobin } from '../../utils/schedule';
import { finalizeLeagueWeek } from '../../jobs/finalizePipeline';

const router = Router();

const ALL_SLOTS = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Other', 'Flex', 'Bench-1', 'Bench-2', 'Bench-3'];

// Creates four users + an active 4-team league with full rosters, a 10-week
// round-robin schedule, and week-1 scores.  Returns credentials for all 4 users
// so E2E tests can exercise lineup/matchup/standings without running a draft.
router.post('/active-league', async (req, res, next) => {
  try {
    const ts = Date.now();
    const hash = await bcrypt.hash('testpass123', 10);

    const [user1, user2, user3, user4] = await Promise.all([
      prisma.user.create({ data: { email: `e2e-u1-${ts}@test.internal`, passwordHash: hash, username: `e2eu1${ts}` } }),
      prisma.user.create({ data: { email: `e2e-u2-${ts}@test.internal`, passwordHash: hash, username: `e2eu2${ts}` } }),
      prisma.user.create({ data: { email: `e2e-u3-${ts}@test.internal`, passwordHash: hash, username: `e2eu3${ts}` } }),
      prisma.user.create({ data: { email: `e2e-u4-${ts}@test.internal`, passwordHash: hash, username: `e2eu4${ts}` } }),
    ]);

    let inviteCode = generateInviteCode();
    while (await prisma.league.findUnique({ where: { inviteCode } })) {
      inviteCode = generateInviteCode();
    }

    const league = await prisma.league.create({
      data: {
        name: `E2E League ${ts}`,
        commissionerId: user1.id,
        teamCount: 4,
        isPrivate: true,
        status: 'active',
        inviteCode,
        currentWeek: 1,
        seasonYear: 2026,
        draftTime: new Date(Date.now() - 14 * 24 * 60 * 60_000),
      },
    });

    // Distinct waiver priorities so waiver-conflict e2e tests are deterministic
    // (Team A holds the top spot).
    const [team1, team2, team3, team4] = await Promise.all([
      prisma.team.create({ data: { leagueId: league.id, userId: user1.id, name: 'E2E Team A', draftPosition: 1, waiverPriority: 1 } }),
      prisma.team.create({ data: { leagueId: league.id, userId: user2.id, name: 'E2E Team B', draftPosition: 2, waiverPriority: 2 } }),
      prisma.team.create({ data: { leagueId: league.id, userId: user3.id, name: 'E2E Team C', draftPosition: 3, waiverPriority: 3 } }),
      prisma.team.create({ data: { leagueId: league.id, userId: user4.id, name: 'E2E Team D', draftPosition: 4, waiverPriority: 4 } }),
    ]);

    // Fetch artist pools — need unique artists per slot across all 4 teams.
    const [rbhArtists, popArtists, rockArtists, countryArtists, otherArtists] = await Promise.all([
      prisma.artist.findMany({ where: { primaryGenre: 'R&B/Hip-Hop' }, take: 10 }),
      prisma.artist.findMany({ where: { primaryGenre: 'Pop' }, take: 12 }),
      prisma.artist.findMany({ where: { primaryGenre: 'Rock & Alternative' }, take: 4 }),
      prisma.artist.findMany({ where: { primaryGenre: 'Country' }, take: 6 }),
      prisma.artist.findMany({ where: { primaryGenre: { in: ['Latin', 'Dance', 'K-Pop', 'Afrobeats', 'Other'] } }, take: 4 }),
    ]);

    if (
      rbhArtists.length < 10 || popArtists.length < 12 ||
      rockArtists.length < 4 || countryArtists.length < 6 || otherArtists.length < 4
    ) {
      res.status(500).json({ error: 'Insufficient artists in test DB — run e2eSeed first.' });
      return;
    }

    // 36 unique artists across 4 teams × 9 slots.
    // rbh[0-9], pop[0-11], rock[0-3], country[0-5], other[0-3]
    const rosters = [
      // Team A
      [
        { slot: 'R&B/Hip-Hop',        artistId: rbhArtists[0].id },
        { slot: 'Pop',                 artistId: popArtists[0].id },
        { slot: 'Rock & Alternative',  artistId: rockArtists[0].id },
        { slot: 'Country',             artistId: countryArtists[0].id },
        { slot: 'Other',               artistId: otherArtists[0].id },
        { slot: 'Flex',                artistId: rbhArtists[1].id },
        { slot: 'Bench-1',             artistId: popArtists[1].id },
        { slot: 'Bench-2',             artistId: rbhArtists[2].id },
        { slot: 'Bench-3',             artistId: popArtists[2].id },
      ],
      // Team B
      [
        { slot: 'R&B/Hip-Hop',        artistId: rbhArtists[3].id },
        { slot: 'Pop',                 artistId: popArtists[3].id },
        { slot: 'Rock & Alternative',  artistId: rockArtists[1].id },
        { slot: 'Country',             artistId: countryArtists[1].id },
        { slot: 'Other',               artistId: otherArtists[1].id },
        { slot: 'Flex',                artistId: popArtists[4].id },
        { slot: 'Bench-1',             artistId: rbhArtists[4].id },
        { slot: 'Bench-2',             artistId: popArtists[5].id },
        { slot: 'Bench-3',             artistId: countryArtists[2].id },
      ],
      // Team C
      [
        { slot: 'R&B/Hip-Hop',        artistId: rbhArtists[5].id },
        { slot: 'Pop',                 artistId: popArtists[6].id },
        { slot: 'Rock & Alternative',  artistId: rockArtists[2].id },
        { slot: 'Country',             artistId: countryArtists[3].id },
        { slot: 'Other',               artistId: otherArtists[2].id },
        { slot: 'Flex',                artistId: popArtists[7].id },
        { slot: 'Bench-1',             artistId: rbhArtists[6].id },
        { slot: 'Bench-2',             artistId: popArtists[8].id },
        { slot: 'Bench-3',             artistId: countryArtists[4].id },
      ],
      // Team D
      [
        { slot: 'R&B/Hip-Hop',        artistId: rbhArtists[7].id },
        { slot: 'Pop',                 artistId: popArtists[9].id },
        { slot: 'Rock & Alternative',  artistId: rockArtists[3].id },
        { slot: 'Country',             artistId: countryArtists[5].id },
        { slot: 'Other',               artistId: otherArtists[3].id },
        { slot: 'Flex',                artistId: rbhArtists[8].id },
        { slot: 'Bench-1',             artistId: popArtists[10].id },
        { slot: 'Bench-2',             artistId: rbhArtists[9].id },
        { slot: 'Bench-3',             artistId: popArtists[11].id },
      ],
    ];

    const teams = [team1, team2, team3, team4];
    const slotSet = new Set(ALL_SLOTS);

    for (let t = 0; t < 4; t++) {
      const teamId = teams[t].id;
      const usedSlots = new Set(rosters[t].map((r) => r.slot));
      await Promise.all([
        ...rosters[t].map((r) => prisma.rosterSpot.create({ data: { teamId, slot: r.slot, artistId: r.artistId } })),
        ...[...slotSet].filter((s) => !usedSlots.has(s)).map((s) =>
          prisma.rosterSpot.create({ data: { teamId, slot: s, artistId: null } })
        ),
      ]);
    }

    // 10-week round-robin: 2 matchups per week = 20 total.
    // Week 1: (A vs D), (B vs C)
    // Week 2: (A vs C), (D vs B)
    // Week 3: (A vs B), (C vs D)
    // Repeats on a 3-week cycle (teams 2-4 rotate, team 1 is pinned).
    const teamIds = teams.map((t) => t.id);
    const allMatchups = buildRoundRobin(teamIds, league.id, 10);

    // Set week-1 scores so the matchup/standings views have data to display.
    // Team A (home) faces Team D (away) in week 1.
    const week1 = allMatchups.map((m) => {
      if (m.week !== 1) return m;
      // A vs D
      if (m.homeTeamId === team1.id) return { ...m, homeScore: 42.5, awayScore: 38.0 };
      // B vs C
      if (m.homeTeamId === team2.id) return { ...m, homeScore: 35.0, awayScore: 40.0 };
      return m;
    });

    await prisma.matchup.createMany({ data: week1 });

    const [token1, token2, token3, token4] = [
      signToken(user1.id), signToken(user2.id), signToken(user3.id), signToken(user4.id),
    ];

    res.json({
      user1: { id: user1.id, email: user1.email, token: token1 },
      user2: { id: user2.id, email: user2.email, token: token2 },
      user3: { id: user3.id, email: user3.email, token: token3 },
      user4: { id: user4.id, email: user4.email, token: token4 },
      leagueId: league.id,
      team1Id: team1.id,
      team2Id: team2.id,
      team3Id: team3.id,
      team4Id: team4.id,
    });
  } catch (err) {
    next(err);
  }
});

// Creates an active N-team league (default 8) at the end of the regular season:
// weeks 1-9 finalized, week 10 scored but NOT finalized, currentWeek = 10, and
// team records set so Team i finishes as seed i. Running
// finalizeLeagueWeek(leagueId, 10, 2026) then exercises playoff bracket
// generation. Teams have empty rosters — playoff simulation sets matchup
// scores directly.
router.post('/advance-to-playoffs', async (req, res, next) => {
  try {
    const teamCount = Math.min(Math.max(Number(req.body?.teamCount) || 8, 2), 12);
    const ts = Date.now();
    const hash = await bcrypt.hash('testpass123', 10);

    const users = await Promise.all(
      Array.from({ length: teamCount }, (_, i) =>
        prisma.user.create({
          data: { email: `e2e-po${i + 1}-${ts}@test.internal`, passwordHash: hash, username: `e2epo${i + 1}${ts}` },
        }),
      ),
    );

    let inviteCode = generateInviteCode();
    while (await prisma.league.findUnique({ where: { inviteCode } })) {
      inviteCode = generateInviteCode();
    }

    const league = await prisma.league.create({
      data: {
        name: `E2E Playoffs ${ts}`,
        commissionerId: users[0].id,
        teamCount,
        isPrivate: true,
        status: 'active',
        inviteCode,
        currentWeek: 10,
        seasonYear: 2026,
        draftTime: new Date(Date.now() - 90 * 24 * 60 * 60_000),
      },
    });

    // Records descend by team index so the standings sort (wins desc,
    // pointsFor desc) seeds Team 1 first, Team 2 second, etc.
    const teams: { id: string; name: string }[] = [];
    for (let i = 1; i <= teamCount; i++) {
      const wins = Math.max(0, Math.min(9, 10 - i));
      teams.push(
        await prisma.team.create({
          data: {
            leagueId: league.id,
            userId: users[i - 1].id,
            name: `Seed ${i} Team`,
            draftPosition: i,
            wins,
            losses: 9 - wins,
            pointsFor: 1000 - i * 10,
          },
        }),
      );
      await Promise.all(
        ALL_SLOTS.map((slot) => prisma.rosterSpot.create({ data: { teamId: teams[i - 1].id, slot, artistId: null } })),
      );
    }

    // Week 10 is a dead tie everywhere (equal scores, empty rosters), so
    // finalizing it leaves every record untouched and the seed order intact.
    const allMatchups = buildRoundRobin(teams.map((t) => t.id), league.id, 10).map((m) =>
      m.week < 10
        ? { ...m, homeScore: 50, awayScore: 40, winnerId: m.homeTeamId, isFinalized: true }
        : { ...m, homeScore: 50, awayScore: 50 },
    );
    await prisma.matchup.createMany({ data: allMatchups });

    res.json({
      leagueId: league.id,
      token: signToken(users[0].id),
      tokens: users.map((u) => signToken(u.id)),
      userIds: users.map((u) => u.id),
      teams: teams.map((t, i) => ({ id: t.id, name: t.name, seed: i + 1 })),
    });
  } catch (err) {
    next(err);
  }
});

// Runs the real weekly finalization (winner resolution, playoff bracket
// generation, week advance / season completion) for a league.
router.post('/finalize-week', async (req, res, next) => {
  try {
    const { leagueId, week } = req.body as { leagueId: string; week?: number };
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
    await finalizeLeagueWeek(leagueId, week ?? league.currentWeek, league.seasonYear);
    res.json({ ok: true });
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
