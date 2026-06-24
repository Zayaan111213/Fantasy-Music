import { prisma } from '../db/prisma';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface ItunesTrackResult {
  wrapperType?: string;
  artworkUrl100?: string;
}

interface ItunesResponse {
  resultCount: number;
  results: ItunesTrackResult[];
}

export async function runImageBackfill(): Promise<void> {
  const artists = await prisma.artist.findMany({
    where: { imageUrl: null },
    select: { id: true, name: true, appleArtistId: true },
    orderBy: { createdAt: 'asc' },
  });

  if (artists.length === 0) {
    console.log('[images] all artists already have images');
    return;
  }

  console.log(`[images] fetching artwork for ${artists.length} artists...`);

  let updated = 0;
  for (let i = 0; i < artists.length; i++) {
    const artist = artists[i];
    const url = artist.appleArtistId
      ? `https://itunes.apple.com/lookup?id=${artist.appleArtistId}&entity=musicTrack&limit=1`
      : `https://itunes.apple.com/search?term=${encodeURIComponent(artist.name)}&entity=musicTrack&limit=1&media=music`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[images] [${i + 1}/${artists.length}] ${artist.name} — HTTP ${res.status}, skipping`);
        await sleep(2000);
        continue;
      }

      const data = (await res.json()) as ItunesResponse;
      const track = data.results?.find((r) => r.wrapperType === 'track') ?? data.results?.[0];
      if (!track?.artworkUrl100) {
        console.log(`[images] [${i + 1}/${artists.length}] ${artist.name} — no artwork found`);
        await sleep(1000);
        continue;
      }

      const imageUrl = track.artworkUrl100.replace('100x100bb', '300x300bb');
      await prisma.artist.update({ where: { id: artist.id }, data: { imageUrl } });
      console.log(`[images] [${i + 1}/${artists.length}] ${artist.name} ✓`);
      updated++;
    } catch (err) {
      console.error(`[images] [${i + 1}/${artists.length}] ${artist.name} — error:`, err);
    }

    if (i < artists.length - 1) await sleep(1000);
  }

  console.log(`[images] done — updated ${updated}/${artists.length} artists`);
}

if (require.main === module) {
  runImageBackfill()
    .catch((err) => { console.error('[images] fatal:', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
