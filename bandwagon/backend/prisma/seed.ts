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
  // Hip-Hop (40)
  { name: 'Drake', primaryGenre: 'Hip-Hop', secondaryGenres: ['R&B'] },
  { name: 'Kendrick Lamar', primaryGenre: 'Hip-Hop' },
  { name: 'Travis Scott', primaryGenre: 'Hip-Hop', secondaryGenres: ['Rap'] },
  { name: 'J. Cole', primaryGenre: 'Hip-Hop' },
  { name: 'Nicki Minaj', primaryGenre: 'Hip-Hop', secondaryGenres: ['Pop'] },
  { name: 'Cardi B', primaryGenre: 'Hip-Hop' },
  { name: 'Future', primaryGenre: 'Hip-Hop' },
  { name: 'Lil Baby', primaryGenre: 'Hip-Hop' },
  { name: 'Lil Durk', primaryGenre: 'Hip-Hop' },
  { name: 'Gunna', primaryGenre: 'Hip-Hop' },
  { name: 'Young Thug', primaryGenre: 'Hip-Hop' },
  { name: 'Roddy Ricch', primaryGenre: 'Hip-Hop' },
  { name: 'DaBaby', primaryGenre: 'Hip-Hop' },
  { name: 'Polo G', primaryGenre: 'Hip-Hop' },
  { name: 'NBA YoungBoy', primaryGenre: 'Hip-Hop' },
  { name: 'Moneybagg Yo', primaryGenre: 'Hip-Hop' },
  { name: 'Lil Uzi Vert', primaryGenre: 'Hip-Hop' },
  { name: 'Pop Smoke', primaryGenre: 'Hip-Hop' },
  { name: 'A$AP Rocky', primaryGenre: 'Hip-Hop' },
  { name: 'Tyler, the Creator', primaryGenre: 'Hip-Hop', secondaryGenres: ['Alternative'] },
  { name: 'Meek Mill', primaryGenre: 'Hip-Hop' },
  { name: 'Rick Ross', primaryGenre: 'Hip-Hop' },
  { name: 'Kevin Gates', primaryGenre: 'Hip-Hop' },
  { name: 'Jack Harlow', primaryGenre: 'Hip-Hop', secondaryGenres: ['Pop'] },
  { name: 'Fivio Foreign', primaryGenre: 'Hip-Hop' },
  { name: 'Latto', primaryGenre: 'Hip-Hop' },
  { name: 'Ice Spice', primaryGenre: 'Hip-Hop' },
  { name: 'GloRilla', primaryGenre: 'Hip-Hop' },
  { name: 'Sexyy Red', primaryGenre: 'Hip-Hop' },
  { name: 'Doechii', primaryGenre: 'Hip-Hop', secondaryGenres: ['R&B'] },
  { name: 'Playboi Carti', primaryGenre: 'Hip-Hop' },
  { name: 'Kodkodak Black', primaryGenre: 'Hip-Hop' },
  { name: '21 Savage', primaryGenre: 'Hip-Hop' },
  { name: 'Offset', primaryGenre: 'Hip-Hop' },
  { name: 'Quavo', primaryGenre: 'Hip-Hop' },
  { name: 'Don Toliver', primaryGenre: 'Hip-Hop', secondaryGenres: ['R&B'] },
  { name: 'Central Cee', primaryGenre: 'Hip-Hop' },
  { name: 'Metro Boomin', primaryGenre: 'Hip-Hop' },
  { name: 'Tee Grizzley', primaryGenre: 'Hip-Hop' },
  { name: 'EST Gee', primaryGenre: 'Hip-Hop' },

  // Pop (40)
  { name: 'Taylor Swift', primaryGenre: 'Pop', secondaryGenres: ['Country'] },
  { name: 'Billie Eilish', primaryGenre: 'Pop', secondaryGenres: ['Alternative'] },
  { name: 'Dua Lipa', primaryGenre: 'Pop' },
  { name: 'The Weeknd', primaryGenre: 'Pop', secondaryGenres: ['R&B'] },
  { name: 'Ariana Grande', primaryGenre: 'Pop', secondaryGenres: ['R&B'] },
  { name: 'Harry Styles', primaryGenre: 'Pop', secondaryGenres: ['Rock'] },
  { name: 'Olivia Rodrigo', primaryGenre: 'Pop', secondaryGenres: ['Alternative'] },
  { name: 'Post Malone', primaryGenre: 'Pop', secondaryGenres: ['Hip-Hop'] },
  { name: 'Ed Sheeran', primaryGenre: 'Pop' },
  { name: 'Justin Bieber', primaryGenre: 'Pop', secondaryGenres: ['R&B'] },
  { name: 'Doja Cat', primaryGenre: 'Pop', secondaryGenres: ['Hip-Hop'] },
  { name: 'Lizzo', primaryGenre: 'Pop', secondaryGenres: ['R&B'] },
  { name: 'Sabrina Carpenter', primaryGenre: 'Pop' },
  { name: 'Charli XCX', primaryGenre: 'Pop', secondaryGenres: ['Dance/Electronic'] },
  { name: 'Gracie Abrams', primaryGenre: 'Pop' },
  { name: 'Benson Boone', primaryGenre: 'Pop' },
  { name: 'Teddy Swims', primaryGenre: 'Pop', secondaryGenres: ['R&B'] },
  { name: 'Zach Bryan', primaryGenre: 'Pop', secondaryGenres: ['Country'] },
  { name: 'Noah Kahan', primaryGenre: 'Pop', secondaryGenres: ['Folk'] },
  { name: 'Tate McRae', primaryGenre: 'Pop' },
  { name: 'Sia', primaryGenre: 'Pop' },
  { name: 'Camila Cabello', primaryGenre: 'Pop', secondaryGenres: ['Latin'] },
  { name: 'Selena Gomez', primaryGenre: 'Pop', secondaryGenres: ['R&B'] },
  { name: 'Lady Gaga', primaryGenre: 'Pop', secondaryGenres: ['Dance/Electronic'] },
  { name: 'Katy Perry', primaryGenre: 'Pop' },
  { name: 'Adele', primaryGenre: 'Pop', secondaryGenres: ['Soul'] },
  { name: 'Rihanna', primaryGenre: 'Pop', secondaryGenres: ['R&B'] },
  { name: 'Bruno Mars', primaryGenre: 'Pop', secondaryGenres: ['R&B'] },
  { name: 'Charlie Puth', primaryGenre: 'Pop' },
  { name: 'Halsey', primaryGenre: 'Pop', secondaryGenres: ['Alternative'] },
  { name: 'Meghan Trainor', primaryGenre: 'Pop' },
  { name: 'Lewis Capaldi', primaryGenre: 'Pop' },
  { name: 'Kim Petras', primaryGenre: 'Pop', secondaryGenres: ['Dance/Electronic'] },
  { name: 'Sam Smith', primaryGenre: 'Pop', secondaryGenres: ['R&B'] },
  { name: 'Conan Gray', primaryGenre: 'Pop' },
  { name: 'Troye Sivan', primaryGenre: 'Pop' },
  { name: 'Lana Del Rey', primaryGenre: 'Pop', secondaryGenres: ['Alternative'] },
  { name: 'Miley Cyrus', primaryGenre: 'Pop', secondaryGenres: ['Rock'] },
  { name: 'Ava Max', primaryGenre: 'Pop' },
  { name: 'Bebe Rexha', primaryGenre: 'Pop', secondaryGenres: ['R&B'] },

  // Rock (25)
  { name: 'Imagine Dragons', primaryGenre: 'Rock', secondaryGenres: ['Alternative'] },
  { name: 'Twenty One Pilots', primaryGenre: 'Rock', secondaryGenres: ['Alternative'] },
  { name: 'Foo Fighters', primaryGenre: 'Rock' },
  { name: 'Coldplay', primaryGenre: 'Rock', secondaryGenres: ['Pop'] },
  { name: 'Linkin Park', primaryGenre: 'Rock', secondaryGenres: ['Alternative'] },
  { name: 'Green Day', primaryGenre: 'Rock' },
  { name: 'Fall Out Boy', primaryGenre: 'Rock', secondaryGenres: ['Alternative'] },
  { name: 'Panic! at the Disco', primaryGenre: 'Rock', secondaryGenres: ['Alternative'] },
  { name: 'My Chemical Romance', primaryGenre: 'Rock', secondaryGenres: ['Alternative'] },
  { name: 'Arctic Monkeys', primaryGenre: 'Rock', secondaryGenres: ['Alternative'] },
  { name: 'Paramore', primaryGenre: 'Rock', secondaryGenres: ['Alternative'] },
  { name: 'Muse', primaryGenre: 'Rock' },
  { name: 'Kings of Leon', primaryGenre: 'Rock' },
  { name: 'The 1975', primaryGenre: 'Rock', secondaryGenres: ['Alternative'] },
  { name: 'Hozier', primaryGenre: 'Rock', secondaryGenres: ['Folk'] },
  { name: 'Weezer', primaryGenre: 'Rock' },
  { name: 'Highly Suspect', primaryGenre: 'Rock' },
  { name: 'Maneskin', primaryGenre: 'Rock' },
  { name: 'Machine Gun Kelly', primaryGenre: 'Rock', secondaryGenres: ['Pop'] },
  { name: 'Badflower', primaryGenre: 'Rock' },
  { name: 'Nothing But Thieves', primaryGenre: 'Rock', secondaryGenres: ['Alternative'] },
  { name: 'Metallica', primaryGenre: 'Rock' },
  { name: 'Red Hot Chili Peppers', primaryGenre: 'Rock' },
  { name: 'Pearl Jam', primaryGenre: 'Rock' },
  { name: 'Jack White', primaryGenre: 'Rock' },

  // Country (20)
  { name: 'Morgan Wallen', primaryGenre: 'Country' },
  { name: 'Luke Combs', primaryGenre: 'Country' },
  { name: 'Chris Stapleton', primaryGenre: 'Country' },
  { name: 'Kacey Musgraves', primaryGenre: 'Country', secondaryGenres: ['Pop'] },
  { name: 'Cody Johnson', primaryGenre: 'Country' },
  { name: 'Jelly Roll', primaryGenre: 'Country', secondaryGenres: ['Hip-Hop'] },
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

  // Latin (20)
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

  // Dance/Electronic (15)
  { name: 'David Guetta', primaryGenre: 'Dance/Electronic' },
  { name: 'Calvin Harris', primaryGenre: 'Dance/Electronic' },
  { name: 'Marshmello', primaryGenre: 'Dance/Electronic' },
  { name: 'The Chainsmokers', primaryGenre: 'Dance/Electronic', secondaryGenres: ['Pop'] },
  { name: 'Diplo', primaryGenre: 'Dance/Electronic' },
  { name: 'Kygo', primaryGenre: 'Dance/Electronic', secondaryGenres: ['Pop'] },
  { name: 'Zedd', primaryGenre: 'Dance/Electronic', secondaryGenres: ['Pop'] },
  { name: 'Skrillex', primaryGenre: 'Dance/Electronic' },
  { name: 'Martin Garrix', primaryGenre: 'Dance/Electronic' },
  { name: 'Tiësto', primaryGenre: 'Dance/Electronic' },
  { name: 'Alesso', primaryGenre: 'Dance/Electronic', secondaryGenres: ['Pop'] },
  { name: 'ILLENIUM', primaryGenre: 'Dance/Electronic' },
  { name: 'Alan Walker', primaryGenre: 'Dance/Electronic', secondaryGenres: ['Pop'] },
  { name: 'Disclosure', primaryGenre: 'Dance/Electronic' },
  { name: 'Flume', primaryGenre: 'Dance/Electronic' },

  // World / R&B / Other (20 - eligible for Niche slot)
  { name: 'SZA', primaryGenre: 'R&B', secondaryGenres: ['Pop'] },
  { name: 'H.E.R.', primaryGenre: 'R&B' },
  { name: 'Jhené Aiko', primaryGenre: 'R&B' },
  { name: 'Summer Walker', primaryGenre: 'R&B' },
  { name: 'Ari Lennox', primaryGenre: 'R&B' },
  { name: 'Giveon', primaryGenre: 'R&B' },
  { name: 'Lucky Daye', primaryGenre: 'R&B' },
  { name: 'Daniel Caesar', primaryGenre: 'R&B', secondaryGenres: ['Pop'] },
  { name: 'Frank Ocean', primaryGenre: 'R&B', secondaryGenres: ['Alternative'] },
  { name: 'BTS', primaryGenre: 'World', secondaryGenres: ['Pop'] },
  { name: 'BLACKPINK', primaryGenre: 'World', secondaryGenres: ['Pop'] },
  { name: 'Stray Kids', primaryGenre: 'World', secondaryGenres: ['Pop'] },
  { name: 'NewJeans', primaryGenre: 'World', secondaryGenres: ['Pop'] },
  { name: 'TWICE', primaryGenre: 'World', secondaryGenres: ['Pop'] },
  { name: 'Wizkid', primaryGenre: 'World', secondaryGenres: ['R&B'] },
  { name: 'Burna Boy', primaryGenre: 'World', secondaryGenres: ['R&B'] },
  { name: 'Tems', primaryGenre: 'World', secondaryGenres: ['R&B'] },
  { name: 'Rema', primaryGenre: 'World', secondaryGenres: ['R&B'] },
  { name: 'Ayra Starr', primaryGenre: 'World', secondaryGenres: ['Pop'] },
  { name: 'Asake', primaryGenre: 'World', secondaryGenres: ['R&B'] },
];

const GENRE_STREAMING_TIERS: {
  genre: string;
  tiers: { minStreams: bigint; maxStreams: bigint | null; points: number }[];
}[] = [
  {
    genre: 'Hip-Hop',
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
    genre: 'Rock',
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
    genre: 'Latin',
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
    genre: 'Dance/Electronic',
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
    genre: 'R&B',
    tiers: [
      { minStreams: BigInt(25_000_000), maxStreams: null, points: 40 },
      { minStreams: BigInt(12_000_000), maxStreams: BigInt(24_999_999), points: 30 },
      { minStreams: BigInt(5_000_000), maxStreams: BigInt(11_999_999), points: 20 },
      { minStreams: BigInt(2_000_000), maxStreams: BigInt(4_999_999), points: 12 },
      { minStreams: BigInt(500_000), maxStreams: BigInt(1_999_999), points: 6 },
      { minStreams: BigInt(1), maxStreams: BigInt(499_999), points: 2 },
      { minStreams: BigInt(0), maxStreams: BigInt(0), points: 0 },
    ],
  },
  {
    genre: 'World',
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
  const hipHopArtists = artists.filter((a) => a.primaryGenre === 'Hip-Hop');
  const popArtists = artists.filter((a) => a.primaryGenre === 'Pop');
  const rockArtists = artists.filter((a) => a.primaryGenre === 'Rock');
  const countryArtists = artists.filter((a) => a.primaryGenre === 'Country');
  const nichArtists = artists.filter(
    (a) => !['Hip-Hop', 'Pop', 'Rock', 'Country'].includes(a.primaryGenre)
  );

  const team1Roster: { slot: string; artist: (typeof artists)[0] }[] = [
    { slot: 'Hip-Hop', artist: hipHopArtists[0] },   // Drake
    { slot: 'Pop', artist: popArtists[0] },            // Taylor Swift
    { slot: 'Rock', artist: rockArtists[0] },          // Imagine Dragons
    { slot: 'Country', artist: countryArtists[0] },    // Morgan Wallen
    { slot: 'Niche', artist: nichArtists[0] },         // SZA
    { slot: 'Flex', artist: hipHopArtists[1] },        // Kendrick Lamar
    { slot: 'Bench-1', artist: popArtists[1] },        // Billie Eilish
    { slot: 'Bench-2', artist: rockArtists[1] },       // Twenty One Pilots
    { slot: 'Bench-3', artist: countryArtists[1] },    // Luke Combs
  ];

  const team2Roster: { slot: string; artist: (typeof artists)[0] }[] = [
    { slot: 'Hip-Hop', artist: hipHopArtists[2] },    // Travis Scott
    { slot: 'Pop', artist: popArtists[2] },             // Dua Lipa
    { slot: 'Rock', artist: rockArtists[2] },           // Foo Fighters
    { slot: 'Country', artist: countryArtists[2] },    // Chris Stapleton
    { slot: 'Niche', artist: nichArtists[1] },          // H.E.R.
    { slot: 'Flex', artist: hipHopArtists[3] },         // J. Cole
    { slot: 'Bench-1', artist: popArtists[3] },         // The Weeknd
    { slot: 'Bench-2', artist: rockArtists[3] },        // Coldplay
    { slot: 'Bench-3', artist: countryArtists[3] },    // Kacey Musgraves
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

  console.log('✅ Seed complete!');
  console.log('   Demo user 1: demo1@bandwagon.app / password123');
  console.log('   Demo user 2: demo2@bandwagon.app / password123');
  console.log(`   Demo league invite code: DEMO-LEAGUE-2026`);
  console.log(`   Total artists seeded: ${artists.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
