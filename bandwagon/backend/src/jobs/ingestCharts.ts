import { prisma } from '../db/prisma';
import type { Artist } from '@prisma/client';

const SONGS_URL = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/songs.json';
const ALBUMS_URL = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/albums.json';

export interface AppleFeedEntry {
  id: string;
  name: string;
  artistName: string;
  artistId: string;
  genres: Array<{ name: string; genreId: string }>;
}

export interface AppleFeedResponse {
  feed: { results: AppleFeedEntry[] };
}

export function getCurrentWeekDate(): Date {
  const now = new Date();
  // Resolve today's calendar date in Pacific time (handles PDT/PST automatically)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(now);
  const ptYear  = parseInt(parts.find((p) => p.type === 'year')!.value);
  const ptMonth = parseInt(parts.find((p) => p.type === 'month')!.value) - 1;
  const ptDay   = parseInt(parts.find((p) => p.type === 'day')!.value);
  // Day of week for that Pacific calendar date (0 = Sun … 6 = Sat)
  const ptDow = new Date(Date.UTC(ptYear, ptMonth, ptDay)).getUTCDay();
  // (ptDow + 5) % 7 = days since last Tuesday (Tue = 2, so (2+5)%7 = 0 ✓)
  const daysBack = (ptDow + 5) % 7;
  return new Date(Date.UTC(ptYear, ptMonth, ptDay - daysBack));
}

export function parseId(raw: string): bigint | null {
  if (!raw || raw.trim() === '') return null;
  try {
    return BigInt(raw.trim());
  } catch {
    return null;
  }
}

export async function fetchFeed(url: string): Promise<AppleFeedResponse> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json() as Promise<AppleFeedResponse>;
}

export async function upsertArtist(entry: AppleFeedEntry): Promise<Artist | null> {
  const appleArtistId = parseId(entry.artistId);
  const genre = entry.genres[0]?.name ?? 'Other';

  try {
    if (appleArtistId !== null) {
      const byId = await prisma.artist.findUnique({ where: { appleArtistId } });
      if (byId) return byId;

      const byName = await prisma.artist.findFirst({ where: { name: entry.artistName } });
      if (byName) {
        return prisma.artist.update({ where: { id: byName.id }, data: { appleArtistId } });
      }

      return prisma.artist.create({
        data: { name: entry.artistName, primaryGenre: genre, appleArtistId },
      });
    } else {
      const byName = await prisma.artist.findFirst({ where: { name: entry.artistName } });
      if (byName) return byName;

      return prisma.artist.create({
        data: { name: entry.artistName, primaryGenre: genre },
      });
    }
  } catch (err) {
    console.error(`  ✗ artist upsert failed for "${entry.artistName}":`, err);
    return null;
  }
}

export async function ingestSongsFromFeed(data: AppleFeedResponse, weekDate: Date): Promise<void> {
  console.log(`[songs] Processing ${data.feed.results.length} entries for ${weekDate.toISOString().slice(0, 10)}`);

  for (let i = 0; i < data.feed.results.length; i++) {
    const entry = data.feed.results[i];
    const rank = i + 1;

    try {
      const artist = await upsertArtist(entry);
      const appleSongId = parseId(entry.id);

      await prisma.chartEntry.upsert({
        where: { weekDate_chart_rank: { weekDate, chart: 'most-played-songs', rank } },
        update: { songTitle: entry.name, appleSongId, artistId: artist?.id ?? null },
        create: {
          weekDate,
          chart: 'most-played-songs',
          rank,
          songTitle: entry.name,
          appleSongId,
          artistId: artist?.id ?? null,
        },
      });
    } catch (err) {
      console.error(`[songs] ✗ rank ${rank} (${entry.name}) failed:`, err);
    }
  }
}

export async function ingestAlbumsFromFeed(data: AppleFeedResponse, weekDate: Date): Promise<void> {
  console.log(`[albums] Processing ${data.feed.results.length} entries for ${weekDate.toISOString().slice(0, 10)}`);

  for (let i = 0; i < data.feed.results.length; i++) {
    const entry = data.feed.results[i];
    const rank = i + 1;

    try {
      const artist = await upsertArtist(entry);
      const appleAlbumId = parseId(entry.id);

      await prisma.albumChartEntry.upsert({
        where: { weekDate_chart_rank: { weekDate, chart: 'most-played-albums', rank } },
        update: { albumTitle: entry.name, appleAlbumId, artistId: artist?.id ?? null },
        create: {
          weekDate,
          chart: 'most-played-albums',
          rank,
          albumTitle: entry.name,
          appleAlbumId,
          artistId: artist?.id ?? null,
        },
      });
    } catch (err) {
      console.error(`[albums] ✗ rank ${rank} (${entry.name}) failed:`, err);
    }
  }
}

async function main(): Promise<void> {
  const weekDate = getCurrentWeekDate();
  console.log(`Ingesting charts for week of ${weekDate.toISOString().split('T')[0]}`);

  const [songs, albums] = await Promise.all([fetchFeed(SONGS_URL), fetchFeed(ALBUMS_URL)]);
  await ingestSongsFromFeed(songs, weekDate);
  await ingestAlbumsFromFeed(albums, weekDate);

  await prisma.$disconnect();
  console.log('\nDone.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    prisma.$disconnect().finally(() => process.exit(1));
  });
}
