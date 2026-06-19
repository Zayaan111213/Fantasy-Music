import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SEASON_YEAR = 2026;
const TOTAL_WEEKS = 10;

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

const ARTIST_DATA: { name: string; primaryGenre: string; secondaryGenres?: string[] }[] = [
  // R&B/Hip-Hop (40)
  { name: 'Drake', primaryGenre: 'R&B/Hip-Hop', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Kendrick Lamar', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Travis Scott', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'J. Cole', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Nicki Minaj', primaryGenre: 'R&B/Hip-Hop', secondaryGenres: ['Pop'] },
  { name: 'Cardi B', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Future', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Lil Baby', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Lil Durk', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Gunna', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Young Thug', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Roddy Ricch', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'DaBaby', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Polo G', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'NBA YoungBoy', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Moneybagg Yo', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Lil Uzi Vert', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Pop Smoke', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'A$AP Rocky', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Tyler, the Creator', primaryGenre: 'R&B/Hip-Hop', secondaryGenres: ['Rock & Alternative'] },
  { name: 'Meek Mill', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Rick Ross', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Kevin Gates', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Jack Harlow', primaryGenre: 'R&B/Hip-Hop', secondaryGenres: ['Pop'] },
  { name: 'Fivio Foreign', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Latto', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Ice Spice', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'GloRilla', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Sexyy Red', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Doechii', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Playboi Carti', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Kodkodak Black', primaryGenre: 'R&B/Hip-Hop' },
  { name: '21 Savage', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Offset', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Quavo', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Don Toliver', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Central Cee', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Metro Boomin', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'SZA', primaryGenre: 'R&B/Hip-Hop', secondaryGenres: ['Pop'] },
  { name: 'H.E.R.', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Jhené Aiko', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Summer Walker', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Ari Lennox', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Giveon', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Lucky Daye', primaryGenre: 'R&B/Hip-Hop' },
  { name: 'Daniel Caesar', primaryGenre: 'R&B/Hip-Hop', secondaryGenres: ['Pop'] },
  { name: 'Frank Ocean', primaryGenre: 'R&B/Hip-Hop', secondaryGenres: ['Rock & Alternative'] },

  // Pop (40)
  { name: 'Taylor Swift', primaryGenre: 'Pop', secondaryGenres: ['Country'] },
  { name: 'Billie Eilish', primaryGenre: 'Pop', secondaryGenres: ['Rock & Alternative'] },
  { name: 'Dua Lipa', primaryGenre: 'Pop' },
  { name: 'The Weeknd', primaryGenre: 'Pop', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Ariana Grande', primaryGenre: 'Pop', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Harry Styles', primaryGenre: 'Pop', secondaryGenres: ['Rock & Alternative'] },
  { name: 'Olivia Rodrigo', primaryGenre: 'Pop', secondaryGenres: ['Rock & Alternative'] },
  { name: 'Post Malone', primaryGenre: 'Pop', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Ed Sheeran', primaryGenre: 'Pop' },
  { name: 'Justin Bieber', primaryGenre: 'Pop', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Doja Cat', primaryGenre: 'Pop', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Lizzo', primaryGenre: 'Pop', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Sabrina Carpenter', primaryGenre: 'Pop' },
  { name: 'Charli XCX', primaryGenre: 'Pop', secondaryGenres: ['Dance'] },
  { name: 'Gracie Abrams', primaryGenre: 'Pop' },
  { name: 'Benson Boone', primaryGenre: 'Pop' },
  { name: 'Teddy Swims', primaryGenre: 'Pop', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Zach Bryan', primaryGenre: 'Pop', secondaryGenres: ['Country'] },
  { name: 'Noah Kahan', primaryGenre: 'Pop', secondaryGenres: ['Other'] },
  { name: 'Tate McRae', primaryGenre: 'Pop' },
  { name: 'Sia', primaryGenre: 'Pop' },
  { name: 'Camila Cabello', primaryGenre: 'Pop', secondaryGenres: ['Other'] },
  { name: 'Selena Gomez', primaryGenre: 'Pop', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Lady Gaga', primaryGenre: 'Pop', secondaryGenres: ['Dance'] },
  { name: 'Katy Perry', primaryGenre: 'Pop' },
  { name: 'Adele', primaryGenre: 'Pop', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Rihanna', primaryGenre: 'Pop', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Bruno Mars', primaryGenre: 'Pop', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Charlie Puth', primaryGenre: 'Pop' },
  { name: 'Halsey', primaryGenre: 'Pop', secondaryGenres: ['Rock & Alternative'] },
  { name: 'Meghan Trainor', primaryGenre: 'Pop' },
  { name: 'Lewis Capaldi', primaryGenre: 'Pop' },
  { name: 'Kim Petras', primaryGenre: 'Pop', secondaryGenres: ['Dance'] },
  { name: 'Sam Smith', primaryGenre: 'Pop', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Conan Gray', primaryGenre: 'Pop' },
  { name: 'Troye Sivan', primaryGenre: 'Pop' },
  { name: 'Lana Del Rey', primaryGenre: 'Pop', secondaryGenres: ['Rock & Alternative'] },
  { name: 'Miley Cyrus', primaryGenre: 'Pop', secondaryGenres: ['Rock & Alternative'] },
  { name: 'Ava Max', primaryGenre: 'Pop' },
  { name: 'Bebe Rexha', primaryGenre: 'Pop', secondaryGenres: ['R&B/Hip-Hop'] },

  // Rock & Alternative (25)
  { name: 'Imagine Dragons', primaryGenre: 'Rock & Alternative' },
  { name: 'Twenty One Pilots', primaryGenre: 'Rock & Alternative' },
  { name: 'Foo Fighters', primaryGenre: 'Rock & Alternative' },
  { name: 'Coldplay', primaryGenre: 'Rock & Alternative', secondaryGenres: ['Pop'] },
  { name: 'Linkin Park', primaryGenre: 'Rock & Alternative' },
  { name: 'Green Day', primaryGenre: 'Rock & Alternative' },
  { name: 'Fall Out Boy', primaryGenre: 'Rock & Alternative' },
  { name: 'Panic! at the Disco', primaryGenre: 'Rock & Alternative' },
  { name: 'My Chemical Romance', primaryGenre: 'Rock & Alternative' },
  { name: 'Arctic Monkeys', primaryGenre: 'Rock & Alternative' },
  { name: 'Paramore', primaryGenre: 'Rock & Alternative' },
  { name: 'Muse', primaryGenre: 'Rock & Alternative' },
  { name: 'Kings of Leon', primaryGenre: 'Rock & Alternative' },
  { name: 'The 1975', primaryGenre: 'Rock & Alternative', secondaryGenres: ['Pop'] },
  { name: 'Hozier', primaryGenre: 'Rock & Alternative', secondaryGenres: ['Other'] },
  { name: 'Weezer', primaryGenre: 'Rock & Alternative' },
  { name: 'Highly Suspect', primaryGenre: 'Rock & Alternative' },
  { name: 'Maneskin', primaryGenre: 'Rock & Alternative' },
  { name: 'Machine Gun Kelly', primaryGenre: 'Rock & Alternative', secondaryGenres: ['Pop'] },
  { name: 'Badflower', primaryGenre: 'Rock & Alternative' },
  { name: 'Nothing But Thieves', primaryGenre: 'Rock & Alternative' },
  { name: 'Metallica', primaryGenre: 'Rock & Alternative' },
  { name: 'Red Hot Chili Peppers', primaryGenre: 'Rock & Alternative' },
  { name: 'Pearl Jam', primaryGenre: 'Rock & Alternative' },
  { name: 'Jack White', primaryGenre: 'Rock & Alternative' },

  // Country (20)
  { name: 'Morgan Wallen', primaryGenre: 'Country' },
  { name: 'Luke Combs', primaryGenre: 'Country' },
  { name: 'Chris Stapleton', primaryGenre: 'Country' },
  { name: 'Kacey Musgraves', primaryGenre: 'Country', secondaryGenres: ['Pop'] },
  { name: 'Cody Johnson', primaryGenre: 'Country' },
  { name: 'Jelly Roll', primaryGenre: 'Country', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Lainey Wilson', primaryGenre: 'Country' },
  { name: 'Tyler Hubbard', primaryGenre: 'Country' },
  { name: 'Bailey Zimmerman', primaryGenre: 'Country' },
  { name: 'Carly Pearce', primaryGenre: 'Country' },
  { name: 'Thomas Rhett', primaryGenre: 'Country', secondaryGenres: ['Pop'] },
  { name: 'Cole Swindell', primaryGenre: 'Country' },
  { name: 'Dierks Bentley', primaryGenre: 'Country' },
  { name: 'Blake Shelton', primaryGenre: 'Country' },
  { name: 'Carrie Underwood', primaryGenre: 'Country', secondaryGenres: ['Pop'] },
  { name: 'Megan Moroney', primaryGenre: 'Country' },
  { name: 'Zach Top', primaryGenre: 'Country' },
  { name: 'Warren Zeiders', primaryGenre: 'Country' },
  { name: 'Dustin Lynch', primaryGenre: 'Country' },
  { name: 'Kane Brown', primaryGenre: 'Country', secondaryGenres: ['Pop'] },

  // Latin (20) - eligible for Other slot
  { name: 'Bad Bunny', primaryGenre: 'Latin' },
  { name: 'J Balvin', primaryGenre: 'Latin' },
  { name: 'Karol G', primaryGenre: 'Latin' },
  { name: 'Ozuna', primaryGenre: 'Latin' },
  { name: 'Rauw Alejandro', primaryGenre: 'Latin' },
  { name: 'Maluma', primaryGenre: 'Latin' },
  { name: 'Anuel AA', primaryGenre: 'Latin' },
  { name: 'Daddy Yankee', primaryGenre: 'Latin' },
  { name: 'Becky G', primaryGenre: 'Latin', secondaryGenres: ['Pop'] },
  { name: 'Nicky Jam', primaryGenre: 'Latin' },
  { name: 'Farruko', primaryGenre: 'Latin' },
  { name: 'Jhay Cortez', primaryGenre: 'Latin' },
  { name: 'Myke Towers', primaryGenre: 'Latin' },
  { name: 'Sech', primaryGenre: 'Latin' },
  { name: 'Lunay', primaryGenre: 'Latin' },
  { name: 'Zion & Lennox', primaryGenre: 'Latin' },
  { name: 'Peso Pluma', primaryGenre: 'Latin' },
  { name: 'Fuerza Regida', primaryGenre: 'Latin' },
  { name: 'Eslabon Armado', primaryGenre: 'Latin' },
  { name: 'Grupo Frontera', primaryGenre: 'Latin' },

  // Dance (15)
  { name: 'David Guetta', primaryGenre: 'Dance' },
  { name: 'Calvin Harris', primaryGenre: 'Dance' },
  { name: 'Marshmello', primaryGenre: 'Dance' },
  { name: 'The Chainsmokers', primaryGenre: 'Dance', secondaryGenres: ['Pop'] },
  { name: 'Diplo', primaryGenre: 'Dance' },
  { name: 'Kygo', primaryGenre: 'Dance', secondaryGenres: ['Pop'] },
  { name: 'Zedd', primaryGenre: 'Dance', secondaryGenres: ['Pop'] },
  { name: 'Skrillex', primaryGenre: 'Dance' },
  { name: 'Martin Garrix', primaryGenre: 'Dance' },
  { name: 'Tiësto', primaryGenre: 'Dance' },
  { name: 'Alesso', primaryGenre: 'Dance', secondaryGenres: ['Pop'] },
  { name: 'ILLENIUM', primaryGenre: 'Dance' },
  { name: 'Alan Walker', primaryGenre: 'Dance', secondaryGenres: ['Pop'] },
  { name: 'Disclosure', primaryGenre: 'Dance' },
  { name: 'Flume', primaryGenre: 'Dance' },

  // K-Pop (5) - eligible for Other slot
  { name: 'BTS', primaryGenre: 'K-Pop', secondaryGenres: ['Pop'] },
  { name: 'BLACKPINK', primaryGenre: 'K-Pop', secondaryGenres: ['Pop'] },
  { name: 'Stray Kids', primaryGenre: 'K-Pop', secondaryGenres: ['Pop'] },
  { name: 'NewJeans', primaryGenre: 'K-Pop', secondaryGenres: ['Pop'] },
  { name: 'TWICE', primaryGenre: 'K-Pop', secondaryGenres: ['Pop'] },

  // Afrobeats (6) - eligible for Other slot
  { name: 'Wizkid', primaryGenre: 'Afrobeats', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Burna Boy', primaryGenre: 'Afrobeats', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Tems', primaryGenre: 'Afrobeats', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Rema', primaryGenre: 'Afrobeats', secondaryGenres: ['R&B/Hip-Hop'] },
  { name: 'Ayra Starr', primaryGenre: 'Afrobeats', secondaryGenres: ['Pop'] },
  { name: 'Asake', primaryGenre: 'Afrobeats', secondaryGenres: ['R&B/Hip-Hop'] },

  // Other (2) - eligible for Other slot
  { name: 'Tee Grizzley', primaryGenre: 'Other' },
  { name: 'EST Gee', primaryGenre: 'Other' },
];

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

async function main() {
  console.log('🌱 Starting seed...');

  const existingArtists = await prisma.artist.count();
  if (existingArtists > 0) {
    console.log('✅ Database already seeded, skipping.');
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
  const tierMap = new Map<string, { minStreams: bigint; maxStreams: bigint | null; points: number }[]>();
  for (const genreConfig of GENRE_STREAMING_TIERS) {
    tierMap.set(genreConfig.genre, genreConfig.tiers);
    for (let i = 0; i < genreConfig.tiers.length; i++) {
      const tier = genreConfig.tiers[i];
      await prisma.genreStreamingTier.create({
        data: {
          genre: genreConfig.genre,
          minStreams: tier.minStreams,
          maxStreams: tier.maxStreams,
          points: tier.points,
          sortOrder: i,
        },
      });
    }
  }

  // Seed artists
  console.log('🎤 Seeding artists...');
  const artists = await Promise.all(
    ARTIST_DATA.map((a) =>
      prisma.artist.create({
        data: {
          name: a.name,
          primaryGenre: a.primaryGenre,
          secondaryGenres: a.secondaryGenres || [],
          imageUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(a.name)}&background=6366f1&color=fff&size=256`,
        },
      })
    )
  );

  // Seed weekly scores for all artists for past 10 weeks
  console.log('📈 Seeding weekly scores...');
  for (const artist of artists) {
    for (let week = 1; week <= TOTAL_WEEKS; week++) {
      const { streams, chartPosition, chartMovement, isNewEntry } = generateMockWeekData(artist.id, week);

      const streamingPoints = scoreStreamingForGenre(streams, artist.primaryGenre, tierMap);
      const chartPositionPoints = scoreChartPosition(chartPosition);
      const chartMovementPoints = scoreChartMovement(chartMovement, isNewEntry);
      const totalPoints = streamingPoints + chartPositionPoints + chartMovementPoints;

      await prisma.weeklyScore.create({
        data: {
          artistId: artist.id,
          week,
          seasonYear: SEASON_YEAR,
          streamingPoints,
          chartPositionPoints,
          chartMovementPoints,
          totalPoints,
          weeklyStreams: BigInt(streams),
          bestChartPosition: chartPosition,
          chartMovement: isNewEntry ? null : chartMovement,
          isFinalized: week < TOTAL_WEEKS,
        },
      });
    }
  }

  // Seed demo users
  console.log('👤 Seeding demo users...');
  const passwordHash = await bcrypt.hash('password123', 10);

  const user1 = await prisma.user.create({
    data: {
      email: 'demo1@bandwagon.app',
      passwordHash,
      username: 'MusicMaven',
      avatarUrl: 'https://ui-avatars.com/api/?name=Music+Maven&background=6366f1&color=fff&size=256',
    },
  });

  const user2 = await prisma.user.create({
    data: {
      email: 'demo2@bandwagon.app',
      passwordHash,
      username: 'ChartWatcher',
      avatarUrl: 'https://ui-avatars.com/api/?name=Chart+Watcher&background=8b5cf6&color=fff&size=256',
    },
  });

  // Seed a demo active league
  console.log('🏆 Seeding demo league...');
  const demoLeague = await prisma.league.create({
    data: {
      name: 'Demo League',
      commissionerId: user1.id,
      teamCount: 2,
      privacy: 'private',
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
  const otherArtists = artists.filter((a) => a.primaryGenre === 'Other');

  const team1Roster: { slot: string; artist: (typeof artists)[0] }[] = [
    { slot: 'R&B/Hip-Hop', artist: rbhiphopArtists[0] },          // Drake
    { slot: 'Pop', artist: popArtists[0] },                         // Taylor Swift
    { slot: 'Rock & Alternative', artist: rockAltArtists[0] },     // Imagine Dragons
    { slot: 'Country', artist: countryArtists[0] },                 // Morgan Wallen
    { slot: 'Other', artist: otherArtists[0] },                     // Bad Bunny
    { slot: 'Flex', artist: rbhiphopArtists[1] },                   // Kendrick Lamar
    { slot: 'Bench-1', artist: popArtists[1] },                     // Billie Eilish
    { slot: 'Bench-2', artist: rockAltArtists[1] },                 // Twenty One Pilots
    { slot: 'Bench-3', artist: countryArtists[1] },                 // Luke Combs
  ];

  const team2Roster: { slot: string; artist: (typeof artists)[0] }[] = [
    { slot: 'R&B/Hip-Hop', artist: rbhiphopArtists[2] },          // Travis Scott
    { slot: 'Pop', artist: popArtists[2] },                         // Dua Lipa
    { slot: 'Rock & Alternative', artist: rockAltArtists[2] },     // Foo Fighters
    { slot: 'Country', artist: countryArtists[2] },                 // Chris Stapleton
    { slot: 'Other', artist: otherArtists[1] },                     // J Balvin
    { slot: 'Flex', artist: rbhiphopArtists[3] },                   // J. Cole
    { slot: 'Bench-1', artist: popArtists[3] },                     // The Weeknd
    { slot: 'Bench-2', artist: rockAltArtists[3] },                 // Coldplay
    { slot: 'Bench-3', artist: countryArtists[3] },                 // Kacey Musgraves
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
        where: { artistId_week_seasonYear: { artistId: id, week, seasonYear: SEASON_YEAR } },
      });
      homeScore += ws?.totalPoints ?? 0;
    }
    for (const id of team2StarterIds) {
      const ws = await prisma.weeklyScore.findUnique({
        where: { artistId_week_seasonYear: { artistId: id, week, seasonYear: SEASON_YEAR } },
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
      name: 'Open Draft — Join Now',
      commissionerId: user1.id,
      teamCount: 8,
      privacy: 'public',
      status: 'pending',
      inviteCode: 'PUBLIC-DEMO-2026',
      seasonYear: SEASON_YEAR,
      draftTime: new Date(Date.now() + 2 * 60 * 60_000), // 2 hours from seed time
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
