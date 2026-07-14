import bcrypt from 'bcryptjs';
import { prisma } from '../db/prisma';
import { updateMatchupScores } from '../scoring/engine';
import { buildRoundRobin } from '../utils/schedule';

const WEEK = 3;
const YEAR = 2026;
const WEEK_DATE = new Date('2026-06-23');

const MAIN_GENRES = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country'];

// 4 demo teams so the playoff bracket (top 4, 1v4 / 2v3) is visible in the demo league.
const DEMO_USERS = [
  { email: 'demo1@bandwagon.app', username: 'MusicMaven' },
  { email: 'demo2@bandwagon.app', username: 'ChartWatcher' },
  { email: 'demo3@bandwagon.app', username: 'BeatBroker' },
  { email: 'demo4@bandwagon.app', username: 'HookHunter' },
];
const TEAM_COUNT = DEMO_USERS.length;

const DEMO_INVITE_CODES = ['CHART-2026', 'PUBLIC-2026'];

type ArtistWithScores = Awaited<ReturnType<typeof prisma.artist.findMany<{
  include: { weeklyScores: true };
}>>>[number];

async function main() {
  // 1. Delete only the demo leagues (cascades to teams, roster spots, matchups,
  // picks, draft state). User-created leagues are left untouched.
  const deleted = await prisma.league.deleteMany({
    where: { inviteCode: { in: DEMO_INVITE_CODES } },
  });
  console.log(`Deleted ${deleted.count} demo league(s)`);

  // 2. Ensure demo users exist
  const passwordHash = await bcrypt.hash('password123', 10);
  const users = await Promise.all(
    DEMO_USERS.map((u) =>
      prisma.user.upsert({
        where: { email: u.email },
        create: { email: u.email, username: u.username, passwordHash },
        update: {},
      }),
    ),
  );

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
    where: { id: { in: realIds }, hiddenAt: null },
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

  // A dry bucket pads with null (empty roster slot) instead of throwing —
  // the leagues are already deleted by this point, so crashing would leave
  // production with no demo data at all.
  function takeUpTo(bucket: string, n: number): (ArtistWithScores | null)[] {
    const picked: (ArtistWithScores | null)[] = bySlot[bucket].splice(0, n);
    while (picked.length < n) {
      console.warn(`⚠ Not enough ${bucket} artists — leaving slot empty`);
      picked.push(null);
    }
    return picked;
  }

  const rnb     = takeUpTo('R&B/Hip-Hop', TEAM_COUNT);
  const pop     = takeUpTo('Pop', TEAM_COUNT);
  const rock    = takeUpTo('Rock & Alternative', TEAM_COUNT);
  const country = takeUpTo('Country', TEAM_COUNT);
  const other   = takeUpTo('Other', TEAM_COUNT);

  const remaining: (ArtistWithScores | null)[] = [
    ...bySlot['R&B/Hip-Hop'],
    ...bySlot['Pop'],
    ...bySlot['Rock & Alternative'],
    ...bySlot['Country'],
    ...bySlot['Other'].filter(a => a.primaryGenre !== "Children's Music"),
  ].sort((a, b) => (b!.weeklyScores[0]?.totalPoints ?? 0) - (a!.weeklyScores[0]?.totalPoints ?? 0));

  const flexNeeded = TEAM_COUNT;
  const benchNeeded = TEAM_COUNT * 3;
  while (remaining.length < flexNeeded + benchNeeded) remaining.push(null);
  const flex  = remaining.splice(0, flexNeeded);
  const bench = remaining.splice(0, benchNeeded);

  const buildRoster = (idx: number) => [
    { slot: 'R&B/Hip-Hop',        artist: rnb[idx] },
    { slot: 'Pop',                artist: pop[idx] },
    { slot: 'Rock & Alternative', artist: rock[idx] },
    { slot: 'Country',            artist: country[idx] },
    { slot: 'Other',              artist: other[idx] },
    { slot: 'Flex',               artist: flex[idx] },
    { slot: 'Bench 1',            artist: bench[idx * 3] },
    { slot: 'Bench 2',            artist: bench[idx * 3 + 1] },
    { slot: 'Bench 3',            artist: bench[idx * 3 + 2] },
  ];

  const rosters = Array.from({ length: TEAM_COUNT }, (_, i) => buildRoster(i));

  // 5. Create active private league
  const league = await prisma.league.create({
    data: {
      name: 'Chart Toppers 2026',
      commissionerId: users[0].id,
      teamCount: TEAM_COUNT,
      isPrivate: true,
      status: 'active',
      inviteCode: DEMO_INVITE_CODES[0],
      currentWeek: WEEK,
      seasonYear: YEAR,
    },
  });

  const teams: { id: string; name: string }[] = [];
  for (let i = 0; i < TEAM_COUNT; i++) {
    teams.push(
      await prisma.team.create({
        data: { leagueId: league.id, userId: users[i].id, name: users[i].username!, draftPosition: i + 1 },
      }),
    );
  }

  await prisma.rosterSpot.createMany({
    data: rosters.flatMap((roster, i) =>
      roster.map(({ slot, artist }) => ({ teamId: teams[i].id, artistId: artist?.id ?? null, slot })),
    ),
  });

  // Round-robin matchups for all 10 weeks. Past weeks get fabricated scores
  // (earlier draft positions trend higher) and the records accumulate from
  // those results so standings, seeds, and history all agree.
  const stats = new Map(teams.map((t) => [t.id, { wins: 0, losses: 0, pointsFor: 0 }]));
  const posOf = new Map(teams.map((t, i) => [t.id, i + 1]));
  const fabricatedScore = (teamId: string, week: number) => {
    const pos = posOf.get(teamId)!;
    return 60 + (TEAM_COUNT - pos) * 6 + ((week * 13 + pos * 7) % 11);
  };

  const allMatchups = buildRoundRobin(teams.map((t) => t.id), league.id, 10).map((m) => {
    if (m.week >= WEEK) return m;
    const homeScore = fabricatedScore(m.homeTeamId, m.week);
    const awayScore = fabricatedScore(m.awayTeamId, m.week);
    const winnerId = homeScore >= awayScore ? m.homeTeamId : m.awayTeamId;
    const loserId = winnerId === m.homeTeamId ? m.awayTeamId : m.homeTeamId;
    stats.get(winnerId)!.wins++;
    stats.get(loserId)!.losses++;
    stats.get(m.homeTeamId)!.pointsFor += homeScore;
    stats.get(m.awayTeamId)!.pointsFor += awayScore;
    return { ...m, homeScore, awayScore, winnerId, isFinalized: true };
  });
  await prisma.matchup.createMany({ data: allMatchups });

  for (const team of teams) {
    await prisma.team.update({ where: { id: team.id }, data: stats.get(team.id)! });
  }

  await updateMatchupScores(league.id, WEEK, YEAR);

  // 6. Create pending public league for join testing
  const publicLeague = await prisma.league.create({
    data: {
      name: 'Open Draft 2026',
      commissionerId: users[0].id,
      teamCount: 8,
      isPrivate: false,
      status: 'pending',
      inviteCode: DEMO_INVITE_CODES[1],
      currentWeek: 1,
      seasonYear: YEAR,
      draftTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.team.create({ data: { leagueId: publicLeague.id, userId: users[0].id, name: 'MusicMaven' } });

  // 7. Print summary
  console.log(`\nLeague: ${league.name} (invite: ${league.inviteCode}) — ${TEAM_COUNT} teams`);
  for (const team of teams) {
    const s = stats.get(team.id)!;
    console.log(`  ${team.name.padEnd(14)} ${s.wins}-${s.losses}  pointsFor ${s.pointsFor.toFixed(1)}`);
  }
  console.log();

  for (let i = 0; i < TEAM_COUNT; i++) {
    console.log(`${teams[i].name}:`);
    let starters = 0;
    for (const { slot, artist } of rosters[i]) {
      const pts = artist?.weeklyScores[0]?.totalPoints ?? 0;
      if (!slot.startsWith('Bench')) starters += pts;
      console.log(`  ${slot.padEnd(20)} ${(artist?.name ?? '(empty)').padEnd(32)} (${artist?.primaryGenre ?? '—'}) → ${pts.toFixed(1)} pts`);
    }
    console.log(`  ${'Starter total'.padEnd(52)} ${starters.toFixed(1)}\n`);
  }
}

main()
  .catch((err) => { console.error('Fatal:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
