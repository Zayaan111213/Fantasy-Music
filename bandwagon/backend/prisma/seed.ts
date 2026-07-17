import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ARTIST_DATA } from './artistData';

const prisma = new PrismaClient();

const SEASON_YEAR = 2026;
const TOTAL_WEEKS = 10;

// Mock "week N" maps to a real calendar chart week: week TOTAL_WEEKS is the
// current chart week (Tuesday PT), counting back 7 days per week.
function mockWeekDate(week: number): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(now);
  const y = parseInt(parts.find((p) => p.type === 'year')!.value);
  const m = parseInt(parts.find((p) => p.type === 'month')!.value) - 1;
  const d = parseInt(parts.find((p) => p.type === 'day')!.value);
  const dow = new Date(Date.UTC(y, m, d)).getUTCDay();
  const daysBack = (dow + 5) % 7;
  const current = new Date(Date.UTC(y, m, d - daysBack));
  return new Date(current.getTime() - (TOTAL_WEEKS - week) * 7 * 24 * 60 * 60 * 1000);
}

// Deterministic pseudo-random from a string seed
function seededRandom(seed: string, index: number = 0): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  h = (h + index * 2654435761) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

const GENRE_STREAMING_TIERS: {
  genre: string;
  tiers: { minStreams: bigint; maxStreams: bigint | null; points: number }[];
}[] = [
  {
    genre: 'R&B/Hip-Hop',
    tiers: [
      { minStreams: BigInt(50_000_000), maxStreams: null, points: 40 },
      { minStreams: BigInt(25_000_000), maxStreams: BigInt(49_999_999), points: 30 },
      { minStreams: BigInt(10_000_000), maxStreams: BigInt(24_999_999), points: 20 },
      { minStreams: BigInt(5_000_000), maxStreams: BigInt(9_999_999), points: 12 },
      { minStreams: BigInt(1_000_000), maxStreams: BigInt(4_999_999), points: 6 },
      { minStreams: BigInt(1), maxStreams: BigInt(999_999), points: 2 },
      { minStreams: BigInt(0), maxStreams: BigInt(0), points: 0 },
    ],
  },
  {
    genre: 'Pop',
    tiers: [
      { minStreams: BigInt(50_000_000), maxStreams: null, points: 40 },
      { minStreams: BigInt(25_000_000), maxStreams: BigInt(49_999_999), points: 30 },
      { minStreams: BigInt(10_000_000), maxStreams: BigInt(24_999_999), points: 20 },
      { minStreams: BigInt(5_000_000), maxStreams: BigInt(9_999_999), points: 12 },
      { minStreams: BigInt(1_000_000), maxStreams: BigInt(4_999_999), points: 6 },
      { minStreams: BigInt(1), maxStreams: BigInt(999_999), points: 2 },
      { minStreams: BigInt(0), maxStreams: BigInt(0), points: 0 },
    ],
  },
  {
    genre: 'Rock & Alternative',
    tiers: [
      { minStreams: BigInt(20_000_000), maxStreams: null, points: 40 },
      { minStreams: BigInt(10_000_000), maxStreams: BigInt(19_999_999), points: 30 },
      { minStreams: BigInt(4_000_000), maxStreams: BigInt(9_999_999), points: 20 },
      { minStreams: BigInt(2_000_000), maxStreams: BigInt(3_999_999), points: 12 },
      { minStreams: BigInt(500_000), maxStreams: BigInt(1_999_999), points: 6 },
      { minStreams: BigInt(1), maxStreams: BigInt(499_999), points: 2 },
      { minStreams: BigInt(0), maxStreams: BigInt(0), points: 0 },
    ],
  },
  {
    genre: 'Country',
    tiers: [
      { minStreams: BigInt(15_000_000), maxStreams: null, points: 40 },
      { minStreams: BigInt(8_000_000), maxStreams: BigInt(14_999_999), points: 30 },
      { minStreams: BigInt(3_000_000), maxStreams: BigInt(7_999_999), points: 20 },
      { minStreams: BigInt(1_500_000), maxStreams: BigInt(2_999_999), points: 12 },
      { minStreams: BigInt(400_000), maxStreams: BigInt(1_499_999), points: 6 },
      { minStreams: BigInt(1), maxStreams: BigInt(399_999), points: 2 },
      { minStreams: BigInt(0), maxStreams: BigInt(0), points: 0 },
    ],
  },
  {
    genre: 'Other',
    tiers: [
      { minStreams: BigInt(20_000_000), maxStreams: null, points: 40 },
      { minStreams: BigInt(10_000_000), maxStreams: BigInt(19_999_999), points: 30 },
      { minStreams: BigInt(4_000_000), maxStreams: BigInt(9_999_999), points: 20 },
      { minStreams: BigInt(2_000_000), maxStreams: BigInt(3_999_999), points: 12 },
      { minStreams: BigInt(500_000), maxStreams: BigInt(1_999_999), points: 6 },
      { minStreams: BigInt(1), maxStreams: BigInt(499_999), points: 2 },
      { minStreams: BigInt(0), maxStreams: BigInt(0), points: 0 },
    ],
  },
  {
    genre: 'Dance',
    tiers: [
      { minStreams: BigInt(10_000_000), maxStreams: null, points: 40 },
      { minStreams: BigInt(5_000_000), maxStreams: BigInt(9_999_999), points: 30 },
      { minStreams: BigInt(2_000_000), maxStreams: BigInt(4_999_999), points: 20 },
      { minStreams: BigInt(1_000_000), maxStreams: BigInt(1_999_999), points: 12 },
      { minStreams: BigInt(250_000), maxStreams: BigInt(999_999), points: 6 },
      { minStreams: BigInt(1), maxStreams: BigInt(249_999), points: 2 },
      { minStreams: BigInt(0), maxStreams: BigInt(0), points: 0 },
    ],
  },
  {
    genre: 'Other',
    tiers: [
      { minStreams: BigInt(15_000_000), maxStreams: null, points: 40 },
      { minStreams: BigInt(7_000_000), maxStreams: BigInt(14_999_999), points: 30 },
      { minStreams: BigInt(3_000_000), maxStreams: BigInt(6_999_999), points: 20 },
      { minStreams: BigInt(1_000_000), maxStreams: BigInt(2_999_999), points: 12 },
      { minStreams: BigInt(250_000), maxStreams: BigInt(999_999), points: 6 },
      { minStreams: BigInt(1), maxStreams: BigInt(249_999), points: 2 },
      { minStreams: BigInt(0), maxStreams: BigInt(0), points: 0 },
    ],
  },
];

function scoreChartPosition(position: number | null): number {
  if (!position) return 0;
  if (position === 1) return 25;
  if (position <= 10) return 18;
  if (position <= 25) return 12;
  if (position <= 50) return 8;
  if (position <= 100) return 4;
  return 0;
}

function scoreChartMovement(movement: number | null, isNewEntry: boolean): number {
  if (isNewEntry) return 10;
  if (!movement) return 0;
  if (movement > 0) return Math.min(movement, 15);
  return Math.max(movement, -10);
}

function scoreStreamingForGenre(
  streams: number,
  genre: string,
  tierMap: Map<string, { minStreams: bigint; maxStreams: bigint | null; points: number }[]>
): number {
  const tiers = tierMap.get(genre) || tierMap.get('Pop')!;
  const s = BigInt(Math.round(streams));
  for (const tier of tiers) {
    if (s >= tier.minStreams && (tier.maxStreams === null || s <= tier.maxStreams)) {
      return tier.points;
    }
  }
  return 0;
}

function generateMockWeekData(
  artistId: string,
  week: number
): {
  streams: number;
  chartPosition: number | null;
  chartMovement: number | null;
  isNewEntry: boolean;
} {
  const r1 = seededRandom(artistId + '-streams', week);
  const r2 = seededRandom(artistId + '-chart', week);
  const r3 = seededRandom(artistId + '-movement', week);
  const r4 = seededRandom(artistId + '-onChart', week);
  const r5 = seededRandom(artistId + '-newEntry', week);

  void r3;

  // Streams: weighted distribution, top artists get more
  const artistPopularity = seededRandom(artistId + '-pop', 0);
  const baseStreams = artistPopularity * 60_000_000;
  const weekVariance = (r1 - 0.5) * 0.4;
  const streams = Math.max(0, Math.round(baseStreams * (1 + weekVariance)));

  // Chart position: ~60% chance of charting
  let chartPosition: number | null = null;
  let chartMovement: number | null = null;
  let isNewEntry = false;

  if (r4 < 0.6) {
    chartPosition = Math.floor(r2 * 100) + 1;

    if (r5 < 0.1 && week > 1) {
      isNewEntry = true;
    } else if (week === 1) {
      isNewEntry = true;
    } else {
      const prevChart = seededRandom(artistId + '-chart', week - 1);
      if (seededRandom(artistId + '-onChart', week - 1) < 0.6) {
        const prevPosition = Math.floor(prevChart * 100) + 1;
        chartMovement = prevPosition - chartPosition;
      } else {
        isNewEntry = true;
      }
    }
  }

  return { streams, chartPosition, chartMovement, isNewEntry };
}

function buildTierMap() {
  const tierMap = new Map<string, { minStreams: bigint; maxStreams: bigint | null; points: number }[]>();
  for (const genreConfig of GENRE_STREAMING_TIERS) {
    tierMap.set(genreConfig.genre, genreConfig.tiers);
  }
  return tierMap;
}

async function createWeeklyScores(
  artists: { id: string; primaryGenre: string }[],
  tierMap: Map<string, { minStreams: bigint; maxStreams: bigint | null; points: number }[]>
) {
  const rows: {
    artistId: string; weekDate: Date;
    streamingPoints: number; chartPositionPoints: number; chartMovementPoints: number; totalPoints: number;
    weeklyStreams: bigint; bestChartPosition: number | null; chartMovement: number | null; isFinalized: boolean;
  }[] = [];
  for (const artist of artists) {
    for (let week = 1; week <= TOTAL_WEEKS; week++) {
      const { streams, chartPosition, chartMovement, isNewEntry } = generateMockWeekData(artist.id, week);
      const sp = scoreStreamingForGenre(streams, artist.primaryGenre, tierMap);
      const cp = scoreChartPosition(chartPosition);
      const cm = scoreChartMovement(chartMovement, isNewEntry);
      rows.push({
        artistId: artist.id,
        weekDate: mockWeekDate(week),
        streamingPoints: sp,
        chartPositionPoints: cp,
        chartMovementPoints: cm,
        totalPoints: sp + cp + cm,
        weeklyStreams: BigInt(streams),
        bestChartPosition: chartPosition,
        chartMovement: isNewEntry ? null : chartMovement,
        isFinalized: week < TOTAL_WEEKS,
      });
    }
  }
  await prisma.weeklyScore.createMany({ data: rows, skipDuplicates: true });
}

async function main() {
  console.log('🌱 Starting seed...');

  const [artistCount, weeklyScoreCount] = await Promise.all([
    prisma.artist.count(),
    prisma.weeklyScore.count(),
  ]);

  if (artistCount > 0 && weeklyScoreCount > 0) {
    console.log('✅ Database already seeded, skipping.');
    return;
  }

  if (artistCount > 0 && weeklyScoreCount === 0) {
    console.log('📈 Recovering partial seed: creating missing weekly scores...');
    const artists = await prisma.artist.findMany();
    await createWeeklyScores(artists, buildTierMap());
    console.log('✅ Weekly scores seeded.');
    return;
  }

  // Clear existing data in correct order
  await prisma.draftState.deleteMany();
  await prisma.draftPick.deleteMany();
  await prisma.matchup.deleteMany();
  await prisma.rosterSpot.deleteMany();
  await prisma.weeklyScore.deleteMany();
  await prisma.genreStreamingTier.deleteMany();
  await prisma.team.deleteMany();
  await prisma.league.deleteMany();
  await prisma.artist.deleteMany();
  await prisma.user.deleteMany();

  // Seed genre streaming tiers
  console.log('📊 Seeding genre streaming tiers...');
  const tierMap = buildTierMap();
  const tierRows: { genre: string; minStreams: bigint; maxStreams: bigint | null; points: number; sortOrder: number }[] = [];
  for (const genreConfig of GENRE_STREAMING_TIERS) {
    genreConfig.tiers.forEach((tier, i) => {
      tierRows.push({ genre: genreConfig.genre, minStreams: tier.minStreams, maxStreams: tier.maxStreams, points: tier.points, sortOrder: i });
    });
  }
  await prisma.genreStreamingTier.createMany({ data: tierRows });

  // Seed artists
  console.log('🎤 Seeding artists...');
  const artists = await Promise.all(
    ARTIST_DATA.map((a) =>
      prisma.artist.create({
        data: {
          name: a.name,
          primaryGenre: a.primaryGenre,
          imageUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(a.name)}&background=ea580c&color=fff&size=256`,
        },
      })
    )
  );

  // Seed weekly scores for all artists for past 10 weeks
  console.log('📈 Seeding weekly scores...');
  await createWeeklyScores(artists, tierMap);

  // Seed demo users
  console.log('👤 Seeding demo users...');
  const passwordHash = await bcrypt.hash('password123', 10);

  const user1 = await prisma.user.create({
    data: {
      email: 'demo1@bandwagon.app',
      passwordHash,
      username: 'MusicMaven',
      avatarUrl: 'https://ui-avatars.com/api/?name=Music+Maven&background=ea580c&color=fff&size=256',
    },
  });

  const user2 = await prisma.user.create({
    data: {
      email: 'demo2@bandwagon.app',
      passwordHash,
      username: 'ChartWatcher',
      avatarUrl: 'https://ui-avatars.com/api/?name=Chart+Watcher&background=c2410c&color=fff&size=256',
    },
  });

  // Seed a demo active league
  console.log('🏆 Seeding demo league...');
  const demoLeague = await prisma.league.create({
    data: {
      name: 'Demo League',
      commissionerId: user1.id,
      teamCount: 2,
      isPrivate: true,
      status: 'active',
      inviteCode: 'DEMO-LEAGUE-2026',
      currentWeek: 3,
      seasonYear: SEASON_YEAR,
    },
  });

  const team1 = await prisma.team.create({
    data: {
      leagueId: demoLeague.id,
      userId: user1.id,
      name: "Maven's Hits",
      wins: 2,
      losses: 0,
      pointsFor: 312.5,
      draftPosition: 1,
    },
  });

  const team2 = await prisma.team.create({
    data: {
      leagueId: demoLeague.id,
      userId: user2.id,
      name: "Chart's Choice",
      wins: 0,
      losses: 2,
      pointsFor: 198.0,
      draftPosition: 2,
    },
  });

  // Pick artists for rosters
  const rbhiphopArtists = artists.filter((a) => a.primaryGenre === 'R&B/Hip-Hop');
  const popArtists = artists.filter((a) => a.primaryGenre === 'Pop');
  const rockAltArtists = artists.filter((a) => a.primaryGenre === 'Rock & Alternative');
  const countryArtists = artists.filter((a) => a.primaryGenre === 'Country');
  const otherArtists = artists.filter((a) => !['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country'].includes(a.primaryGenre));

  const team1Roster: { slot: string; artist: (typeof artists)[0] }[] = [
    { slot: 'R&B/Hip-Hop', artist: rbhiphopArtists[0] },
    { slot: 'Pop', artist: popArtists[0] },
    { slot: 'Rock & Alternative', artist: rockAltArtists[0] },
    { slot: 'Country', artist: countryArtists[0] },
    { slot: 'Other', artist: otherArtists[0] },
    { slot: 'Flex', artist: rbhiphopArtists[1] },
    { slot: 'Bench-1', artist: popArtists[1] },
    { slot: 'Bench-2', artist: rockAltArtists[1] },
    { slot: 'Bench-3', artist: countryArtists[1] },
  ];

  const team2Roster: { slot: string; artist: (typeof artists)[0] }[] = [
    { slot: 'R&B/Hip-Hop', artist: rbhiphopArtists[2] },
    { slot: 'Pop', artist: popArtists[2] },
    { slot: 'Rock & Alternative', artist: rockAltArtists[2] },
    { slot: 'Country', artist: countryArtists[2] },
    { slot: 'Other', artist: otherArtists[1] },
    { slot: 'Flex', artist: rbhiphopArtists[3] },
    { slot: 'Bench-1', artist: popArtists[3] },
    { slot: 'Bench-2', artist: rockAltArtists[3] },
    { slot: 'Bench-3', artist: countryArtists[3] },
  ];

  for (const { slot, artist } of team1Roster) {
    await prisma.rosterSpot.create({
      data: { teamId: team1.id, artistId: artist.id, slot },
    });
  }

  for (const { slot, artist } of team2Roster) {
    await prisma.rosterSpot.create({
      data: { teamId: team2.id, artistId: artist.id, slot },
    });
  }

  // Seed matchups for weeks 1-3
  for (let week = 1; week <= 3; week++) {
    const team1StarterIds = team1Roster
      .filter((r) => !r.slot.startsWith('Bench'))
      .map((r) => r.artist.id);
    const team2StarterIds = team2Roster
      .filter((r) => !r.slot.startsWith('Bench'))
      .map((r) => r.artist.id);

    let homeScore = 0;
    let awayScore = 0;
    for (const id of team1StarterIds) {
      const ws = await prisma.weeklyScore.findUnique({
        where: { artistId_weekDate: { artistId: id, weekDate: mockWeekDate(week) } },
      });
      homeScore += ws?.totalPoints ?? 0;
    }
    for (const id of team2StarterIds) {
      const ws = await prisma.weeklyScore.findUnique({
        where: { artistId_weekDate: { artistId: id, weekDate: mockWeekDate(week) } },
      });
      awayScore += ws?.totalPoints ?? 0;
    }

    await prisma.matchup.create({
      data: {
        leagueId: demoLeague.id,
        week,
        homeTeamId: team1.id,
        awayTeamId: team2.id,
        homeScore,
        awayScore,
        winnerId: homeScore >= awayScore ? team1.id : team2.id,
        isFinalized: week < 3,
      },
    });
  }

  // Seed a public pending league so the join page has something to show
  const publicLeague = await prisma.league.create({
    data: {
      name: 'Open Draft: Join Now',
      commissionerId: user1.id,
      teamCount: 8,
      isPrivate: false,
      status: 'pending',
      inviteCode: 'PUBLIC-DEMO-2026',
      seasonYear: SEASON_YEAR,
      draftTime: new Date(Date.now() + 2 * 60 * 60_000),
    },
  });
  await prisma.team.create({
    data: {
      leagueId: publicLeague.id,
      userId: user1.id,
      name: "Maven's Squad",
      draftPosition: 1,
    },
  });

  console.log('✅ Seed complete!');
  console.log('   Demo user 1: demo1@bandwagon.app / password123');
  console.log('   Demo user 2: demo2@bandwagon.app / password123');
  console.log(`   Demo league invite code: DEMO-LEAGUE-2026`);
  console.log(`   Public league invite code: PUBLIC-DEMO-2026`);
  console.log(`   Total artists seeded: ${artists.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
