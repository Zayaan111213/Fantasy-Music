import { prisma } from '../db/prisma';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface ItunesTrackResult {
  wrapperType?: string;
  artworkUrl100?: string;
  artistName?: string;
}

interface ItunesResponse {
  resultCount: number;
  results: ItunesTrackResult[];
}

// Name-search results are often joint-credit tracks ("A, B & Original Cast of
// X") — picking the bare top hit gives unrelated co-credited artists the same
// artwork. Prefer a track where the queried artist is the sole or first-billed
// credit; only fall back to the raw top hit if nothing better-attributed exists.
function pickBestTrack(tracks: ItunesTrackResult[], artistName: string): ItunesTrackResult | undefined {
  const target = artistName.trim().toLowerCase();
  const solo = tracks.find((t) => t.artistName?.trim().toLowerCase() === target);
  if (solo) return solo;
  const firstBilled = tracks.find((t) => {
    const credited = t.artistName?.trim().toLowerCase() ?? '';
    if (!credited.startsWith(target)) return false;
    const rest = credited.slice(target.length);
    return rest === '' || /^[\s,&]/.test(rest);
  });
  if (firstBilled) return firstBilled;
  return tracks[0];
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
      : `https://itunes.apple.com/search?term=${encodeURIComponent(artist.name)}&entity=musicTrack&limit=10&media=music`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[images] [${i + 1}/${artists.length}] ${artist.name} — HTTP ${res.status}, skipping`);
        await sleep(2000);
        continue;
      }

      const data = (await res.json()) as ItunesResponse;
      const tracks = data.results?.filter((r) => r.wrapperType === 'track') ?? data.results ?? [];
      const track = artist.appleArtistId ? tracks[0] : pickBestTrack(tracks, artist.name);
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
