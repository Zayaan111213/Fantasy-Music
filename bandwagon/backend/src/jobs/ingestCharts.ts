import { prisma } from '../db/prisma';
import type { Artist } from '@prisma/client';
import { splitArtistCredit } from '../data/artistCredits';

const SONGS_URL = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/songs.json';
const ALBUMS_URL = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/albums.json';

export interface AppleFeedEntry {
  id: string;
  name: string;
  artistName: string;
  artistId: string;
  genres: Array<{ name: string; genreId: string }>;
  artworkUrl100: string;
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
  const imageUrl = entry.artworkUrl100
    ? entry.artworkUrl100.replace('100x100bb', '300x300bb')
    : undefined;

  try {
    if (appleArtistId !== null) {
      const byId = await prisma.artist.findUnique({ where: { appleArtistId } });
      if (byId) {
        if (byId.imageUrl === null && imageUrl) {
          return prisma.artist.update({ where: { id: byId.id }, data: { imageUrl } });
        }
        return byId;
      }

      const byName = await prisma.artist.findFirst({ where: { name: entry.artistName } });
      if (byName) {
        return prisma.artist.update({
          where: { id: byName.id },
          data: { appleArtistId, ...(byName.imageUrl === null && imageUrl ? { imageUrl } : {}) },
        });
      }

      return prisma.artist.create({
        data: { name: entry.artistName, primaryGenre: genre, appleArtistId, imageUrl },
      });
    }
    return upsertArtistByName(entry.artistName, genre, imageUrl);
  } catch (err) {
    console.error(`  ✗ artist upsert failed for "${entry.artistName}":`, err);
    return null;
  }
}

// Find-or-create by exact name only. Used for components of a split joint
// credit: the feed's artistId belongs to the combined credit, so it must
// never be attached to an individual. genreEnrichedAt stays null so
// backfillGenres re-resolves the genre via iTunes name search.
export async function upsertArtistByName(
  name: string,
  genre: string,
  imageUrl?: string,
): Promise<Artist | null> {
  try {
    const byName = await prisma.artist.findFirst({ where: { name } });
    if (byName) {
      if (byName.imageUrl === null && imageUrl) {
        return prisma.artist.update({ where: { id: byName.id }, data: { imageUrl } });
      }
      return byName;
    }
    return await prisma.artist.create({ data: { name, primaryGenre: genre, imageUrl } });
  } catch (err) {
    console.error(`  ✗ artist upsert failed for "${name}":`, err);
    return null;
  }
}

// Resolves a feed entry to every credited artist. Single credits keep the
// appleArtistId-first path; joint credits ("A, B & C") upsert each component
// by name and never create a combined Artist row.
export async function resolveCreditedArtists(entry: AppleFeedEntry): Promise<Artist[]> {
  const names = splitArtistCredit(entry.artistName);
  const genre = entry.genres[0]?.name ?? 'Other';
  const imageUrl = entry.artworkUrl100
    ? entry.artworkUrl100.replace('100x100bb', '300x300bb')
    : undefined;

  if (names.length <= 1) {
    const artist = await upsertArtist(entry);
    return artist ? [artist] : [];
  }

  console.log(`  [split] "${entry.artistName}" → ${names.join(' | ')}`);
  const artists: Artist[] = [];
  for (const name of names) {
    const artist = await upsertArtistByName(name, genre, imageUrl);
    if (artist) artists.push(artist);
  }
  return artists;
}

export async function ingestSongsFromFeed(data: AppleFeedResponse, weekDate: Date): Promise<void> {
  console.log(`[songs] Processing ${data.feed.results.length} entries for ${weekDate.toISOString().slice(0, 10)}`);

  for (let i = 0; i < data.feed.results.length; i++) {
    const entry = data.feed.results[i];
    const rank = i + 1;

    try {
      const artists = await resolveCreditedArtists(entry);
      if (artists.length === 0) {
        console.error(`[songs] ✗ rank ${rank} (${entry.name}): no artist resolved, skipping`);
        continue;
      }
      const appleSongId = parseId(entry.id);
      const ids = artists.map((a) => a.id);

      // Drop rows for artists no longer credited at this rank (mid-week rank
      // turnover, and retired combined-credit rows after a split). One
      // transaction per rank: concurrent scoring reads (e.g. a catch-up daily
      // in an overlapping container during a deploy) must never observe the
      // deleted-but-not-yet-rewritten window.
      await prisma.$transaction([
        prisma.chartEntry.deleteMany({
          where: {
            weekDate,
            chart: 'most-played-songs',
            rank,
            OR: [{ artistId: null }, { artistId: { notIn: ids } }],
          },
        }),
        ...artists.map((artist) =>
          prisma.chartEntry.upsert({
            where: {
              weekDate_chart_rank_artistId: { weekDate, chart: 'most-played-songs', rank, artistId: artist.id },
            },
            update: { songTitle: entry.name, appleSongId },
            create: {
              weekDate,
              chart: 'most-played-songs',
              rank,
              songTitle: entry.name,
              appleSongId,
              artistId: artist.id,
            },
          }),
        ),
      ]);
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
      const artists = await resolveCreditedArtists(entry);
      if (artists.length === 0) {
        console.error(`[albums] ✗ rank ${rank} (${entry.name}): no artist resolved, skipping`);
        continue;
      }
      const appleAlbumId = parseId(entry.id);
      const ids = artists.map((a) => a.id);

      await prisma.$transaction([
        prisma.albumChartEntry.deleteMany({
          where: {
            weekDate,
            chart: 'most-played-albums',
            rank,
            OR: [{ artistId: null }, { artistId: { notIn: ids } }],
          },
        }),
        ...artists.map((artist) =>
          prisma.albumChartEntry.upsert({
            where: {
              weekDate_chart_rank_artistId: { weekDate, chart: 'most-played-albums', rank, artistId: artist.id },
            },
            update: { albumTitle: entry.name, appleAlbumId },
            create: {
              weekDate,
              chart: 'most-played-albums',
              rank,
              albumTitle: entry.name,
              appleAlbumId,
              artistId: artist.id,
            },
          }),
        ),
      ]);
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
