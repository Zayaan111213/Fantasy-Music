import { PrismaClient } from '@prisma/client';
import { ARTIST_DATA } from './artistData';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Wiping transient test data...');
  // League cascade-deletes teams, roster spots, matchups, draft state, draft picks
  await prisma.league.deleteMany();
  // User cascade-deletes notifications
  await prisma.user.deleteMany();

  const artistCount = await prisma.artist.count();
  if (artistCount > 0) {
    console.log(`✅ Artists already seeded (${artistCount}), skipping artist seed.`);
    return;
  }

  console.log('🎤 Seeding artists for test DB...');
  await prisma.artist.createMany({
    data: ARTIST_DATA.map((a) => ({
      name: a.name,
      primaryGenre: a.primaryGenre,
      imageUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(a.name)}&background=6366f1&color=fff&size=256`,
    })),
    skipDuplicates: true,
  });

  console.log(`✅ Seeded ${ARTIST_DATA.length} artists into test DB.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
