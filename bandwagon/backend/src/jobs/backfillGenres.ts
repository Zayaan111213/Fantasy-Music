import { prisma } from '../db/prisma';
import { lookupArtistGenre } from '../data/itunesGenre';

const DELAY_MS = 4000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runBackfill(): Promise<void> {
  const artists = await prisma.artist.findMany({
    where: { genreEnrichedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, appleArtistId: true, primaryGenre: true },
  });

  if (artists.length === 0) {
    console.log('Found 0 artists to enrich — all done.');
    return;
  }

  console.log(`Found ${artists.length} artists to enrich.`);

  for (let i = 0; i < artists.length; i++) {
    const artist = artists[i];
    const prefix = `[${i + 1}/${artists.length}] ${artist.name}`;

    const mapped = await lookupArtistGenre({
      appleArtistId: artist.appleArtistId,
      name: artist.name,
    });

    if (mapped !== null && mapped !== 'Other') {
      await prisma.artist.update({
        where: { id: artist.id },
        data: { primaryGenre: mapped, genreEnrichedAt: new Date() },
      });
      console.log(`${prefix} — "${artist.primaryGenre}" → "${mapped}"`);
    } else {
      await prisma.artist.update({
        where: { id: artist.id },
        data: { genreEnrichedAt: new Date() },
      });
      const reason = mapped === null ? 'no result' : 'Other (preserved existing genre)';
      console.log(`${prefix} — ${reason}`);
    }

    if (i < artists.length - 1) await sleep(DELAY_MS);
  }

  console.log('Genre backfill complete.');
}

if (require.main === module) {
  runBackfill()
    .catch((err) => { console.error(err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
