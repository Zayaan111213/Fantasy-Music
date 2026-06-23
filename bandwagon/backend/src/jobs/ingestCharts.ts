import { prisma } from '../db/prisma';
import type { Artist } from '@prisma/client';

const SONGS_URL = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/songs.json';
const ALBUMS_URL = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/albums.json';

interface AppleFeedEntry {
  id: string;
  name: string;
  artistName: string;
  artistId: string;
  genres: Array<{ name: string; genreId: string }>;
}

interface AppleFeedResponse {
  feed: { results: AppleFeedEntry[] };
}

function getCurrentWeekDate(): Date {
  const now = new Date();
  // Billboard week starts Friday; (getDay()+2)%7 = days since last Friday
  const daysBack = (now.getDay() + 2) % 7;
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - daysBack));
}

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

async function fetchFeed(url: string): Promise<AppleFeedResponse> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json() as Promise<AppleFeedResponse>;
}

async function upsertArtist(entry: AppleFeedEntry): Promise<Artist | null> {
  const appleArtistId = parseId(entry.artistId);
  const genre = entry.genres[0]?.name ?? 'Other';

  try {
    if (appleArtistId !== null) {
      // Prefer match by Apple artist ID — most reliable
      const byId = await prisma.artist.findUnique({ where: { appleArtistId } });
      if (byId) return byId;

      // Fall back to name — backfill the Apple ID onto the existing row
      const byName = await prisma.artist.findFirst({ where: { name: entry.artistName } });
      if (byName) {
        return prisma.artist.update({ where: { id: byName.id }, data: { appleArtistId } });
      }

      // New artist not in DB yet
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

async function ingestSongs(weekDate: Date): Promise<void> {
  console.log('\n[songs] Fetching...');
  const data = await fetchFeed(SONGS_URL);
  console.log(`[songs] Processing ${data.feed.results.length} entries`);

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

      console.log(`[songs] ${rank}/100 — ${entry.name} by ${entry.artistName}`);
    } catch (err) {
      console.error(`[songs] ✗ rank ${rank} (${entry.name}) failed:`, err);
    }
  }
}

async function ingestAlbums(weekDate: Date): Promise<void> {
  console.log('\n[albums] Fetching...');
  const data = await fetchFeed(ALBUMS_URL);
  console.log(`[albums] Processing ${data.feed.results.length} entries`);

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

      console.log(`[albums] ${rank}/100 — ${entry.name} by ${entry.artistName}`);
    } catch (err) {
      console.error(`[albums] ✗ rank ${rank} (${entry.name}) failed:`, err);
    }
  }
}

async function main(): Promise<void> {
  const weekDate = getCurrentWeekDate();
  console.log(`Ingesting charts for week of ${weekDate.toISOString().split('T')[0]}`);

  await ingestSongs(weekDate);
  await ingestAlbums(weekDate);

  await prisma.$disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  prisma.$disconnect().finally(() => process.exit(1));
});
