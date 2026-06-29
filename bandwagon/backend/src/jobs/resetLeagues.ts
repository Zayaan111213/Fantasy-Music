import bcrypt from 'bcryptjs';
import { prisma } from '../db/prisma';
import { updateMatchupScores } from '../scoring/engine';

const WEEK = 3;
const YEAR = 2026;
const WEEK_DATE = new Date('2026-06-23');

const MAIN_GENRES = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country'];

async function main() {
  // 1. Delete all leagues (cascades to teams, roster spots, matchups, picks, draft state)
  const deleted = await prisma.league.deleteMany();
  console.log(`Deleted ${deleted.count} league(s)`);

  // 2. Ensure demo users exist
  const passwordHash = await bcrypt.hash('password123', 10);
  const [user1, user2] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'demo1@bandwagon.app' },
      create: { email: 'demo1@bandwagon.app', username: 'MusicMaven', passwordHash },
      update: {},
    }),
    prisma.user.upsert({
      where: { email: 'demo2@bandwagon.app' },
      create: { email: 'demo2@bandwagon.app', username: 'ChartWatcher', passwordHash },
      update: {},
    }),
  ]);

  // 3. Find artists with real chart data for this week
  const [songRows, albumRows] = await Promise.all([
    prisma.chartEntry.findMany({
      where: { weekDate: WEEK_DATE, artistId: { not: null } },
      select: { artistId: true },
      distinct: ['artistId'],
    }),
    prisma.albumChartEntry.findMany({
      where: { weekDate: WEEK_DATE, artistId: { not: null } },
      select: { artistId: true },
      distinct: ['artistId'],
    }),
  ]);
  const realIds = [...new Set([
    ...songRows.map(r => r.artistId!),
    ...albumRows.map(r => r.artistId!),
  ])];

  const artists = await prisma.artist.findMany({
    where: { id: { in: realIds } },
    include: { weeklyScores: { where: { week: WEEK, seasonYear: YEAR } } },
    orderBy: { name: 'asc' },
  });

  // 4. Group by slot bucket, sorted by totalPoints desc
  const bySlot: Record<string, typeof artists> = {
    'R&B/Hip-Hop': [],
    'Pop': [],
    'Rock & Alternative': [],
    'Country': [],
    'Other': [],
  };
  for (const a of artists) {
    const bucket = MAIN_GENRES.includes(a.primaryGenre) ? a.primaryGenre : 'Other';
    bySlot[bucket].push(a);
  }
  for (const bucket of Object.values(bySlot)) {
    bucket.sort((a, b) => (b.weeklyScores[0]?.totalPoints ?? 0) - (a.weeklyScores[0]?.totalPoints ?? 0));
  }

  function take(bucket: string, n: number) {
    const pool = bySlot[bucket];
    const picked = pool.splice(0, n);
    if (picked.length < n) throw new Error(`Not enough ${bucket} artists (need ${n}, have ${picked.length})`);
    return picked;
  }

  const rnb     = take('R&B/Hip-Hop', 2);
  const pop     = take('Pop', 2);
  const rock    = take('Rock & Alternative', 2);
  const country = take('Country', 2);
  const other   = take('Other', 2);

  const remaining = [
    ...bySlot['R&B/Hip-Hop'],
    ...bySlot['Pop'],
    ...bySlot['Rock & Alternative'],
    ...bySlot['Country'],
    ...bySlot['Other'].filter(a => a.primaryGenre !== "Children's Music"),
  ].sort((a, b) => (b.weeklyScores[0]?.totalPoints ?? 0) - (a.weeklyScores[0]?.totalPoints ?? 0));

  const flex  = remaining.splice(0, 2);
  const bench = remaining.splice(0, 6);
  if (bench.length < 6) throw new Error('Not enough bench artists');

  const buildRoster = (idx: number) => [
    { slot: 'R&B/Hip-Hop',       artist: rnb[idx] },
    { slot: 'Pop',                artist: pop[idx] },
    { slot: 'Rock & Alternative', artist: rock[idx] },
    { slot: 'Country',            artist: country[idx] },
    { slot: 'Other',              artist: other[idx] },
    { slot: 'Flex',               artist: flex[idx] },
    { slot: 'Bench 1',            artist: bench[idx * 3] },
    { slot: 'Bench 2',            artist: bench[idx * 3 + 1] },
    { slot: 'Bench 3',            artist: bench[idx * 3 + 2] },
  ];

  const roster1 = buildRoster(0);
  const roster2 = buildRoster(1);

  // 5. Create active private league
  const league = await prisma.league.create({
    data: {
      name: 'Chart Toppers 2026',
      commissionerId: user1.id,
      teamCount: 2,
      isPrivate: true,
      status: 'active',
      inviteCode: 'CHART-2026',
      currentWeek: WEEK,
      seasonYear: YEAR,
    },
  });

  const [team1, team2] = await Promise.all([
    prisma.team.create({ data: { leagueId: league.id, userId: user1.id, name: 'MusicMaven', draftPosition: 1, wins: 2, losses: 0 } }),
    prisma.team.create({ data: { leagueId: league.id, userId: user2.id, name: 'ChartWatcher', draftPosition: 2, wins: 0, losses: 2 } }),
  ]);

  await prisma.rosterSpot.createMany({
    data: [
      ...roster1.map(({ slot, artist }) => ({ teamId: team1.id, artistId: artist.id, slot })),
      ...roster2.map(({ slot, artist }) => ({ teamId: team2.id, artistId: artist.id, slot })),
    ],
  });

  // Create all 10 weeks of matchups (2-team league: same pairing every week)
  for (let w = 1; w <= 10; w++) {
    const isFinalized = w < WEEK;
    // Fabricate alternating winners for past weeks so the history looks realistic
    const homeWon = w % 2 === 1; // week 1: home wins, week 2: away wins
    await prisma.matchup.create({
      data: {
        leagueId: league.id,
        week: w,
        homeTeamId: team1.id,
        awayTeamId: team2.id,
        ...(isFinalized && {
          homeScore: homeWon ? 78.5 + w : 61.0 + w,
          awayScore: homeWon ? 61.0 + w : 78.5 + w,
          winnerId: homeWon ? team1.id : team2.id,
          isFinalized: true,
        }),
      },
    });
  }

  await updateMatchupScores(league.id, WEEK, YEAR);

  // 6. Create pending public league for join testing
  const publicLeague = await prisma.league.create({
    data: {
      name: 'Open Draft 2026',
      commissionerId: user1.id,
      teamCount: 8,
      isPrivate: false,
      status: 'pending',
      inviteCode: 'PUBLIC-2026',
      currentWeek: 1,
      seasonYear: YEAR,
      draftTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.team.create({ data: { leagueId: publicLeague.id, userId: user1.id, name: 'MusicMaven' } });

  // 7. Print summary
  const updatedMatchup = await prisma.matchup.findFirst({ where: { leagueId: league.id, week: WEEK } });
  console.log(`\nLeague: ${league.name} (invite: ${league.inviteCode})`);
  console.log(`Week ${WEEK} matchup — MusicMaven: ${updatedMatchup?.homeScore.toFixed(1)} | ChartWatcher: ${updatedMatchup?.awayScore.toFixed(1)}\n`);

  for (const [label, roster] of [['MusicMaven', roster1], ['ChartWatcher', roster2]] as const) {
    console.log(`${label}:`);
    let starters = 0;
    for (const { slot, artist } of roster) {
      const ws = artist.weeklyScores[0];
      const pts = ws?.totalPoints ?? 0;
      if (!slot.startsWith('Bench')) starters += pts;
      console.log(`  ${slot.padEnd(20)} ${artist.name.padEnd(32)} (${artist.primaryGenre}) → ${pts.toFixed(1)} pts`);
    }
    console.log(`  ${'Starter total'.padEnd(52)} ${starters.toFixed(1)}\n`);
  }
}

main()
  .catch((err) => { console.error('Fatal:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
