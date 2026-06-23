import { prisma } from '../db/prisma';
import { ingestSongsFromFeed, ingestAlbumsFromFeed, fetchFeed, type AppleFeedResponse } from './ingestCharts';

const CDX_API = 'http://web.archive.org/cdx/search/cdx';
const WB_BASE  = 'https://web.archive.org/web';
const SONGS_PATH  = 'rss.marketingtools.apple.com/api/v2/us/music/most-played/100/songs.json';
const ALBUMS_PATH = 'rss.marketingtools.apple.com/api/v2/us/music/most-played/100/albums.json';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getLastMonday(date: Date): Date {
  const daysBack = (date.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysBack));
}

function tsToDate(ts: string): Date {
  return new Date(Date.UTC(
    parseInt(ts.slice(0, 4)),
    parseInt(ts.slice(4, 6)) - 1,
    parseInt(ts.slice(6, 8)),
  ));
}

// Returns Map<weekDateISO → wayback_timestamp>; first (oldest) snapshot per week wins.
async function queryCdx(feedPath: string, fromDate: Date): Promise<Map<string, string>> {
  const from = fromDate.toISOString().replace(/-/g, '').slice(0, 8);
  const url = `${CDX_API}?url=${feedPath}&output=json&fl=timestamp&filter=statuscode:200&collapse=timestamp:8&from=${from}&limit=500`;

  // Retry on transient 5xx errors
  let res: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url);
    if (res.status < 500) break;
    console.warn(`  CDX ${res.status}, retrying in ${(attempt + 1) * 3}s...`);
    await sleep((attempt + 1) * 3000);
  }
  if (!res!.ok) throw new Error(`CDX API error: HTTP ${res!.status}`);
  const rows = await res!.json() as string[][];
  if (!rows || rows.length <= 1) return new Map();

  const byWeek = new Map<string, string>();
  for (const [ts] of rows.slice(1)) {
    const snapDate = tsToDate(ts);
    const weekDate = getLastMonday(snapDate);
    const key = weekDate.toISOString().slice(0, 10);
    if (!byWeek.has(key)) byWeek.set(key, ts);
  }
  return byWeek;
}

async function fetchArchived(timestamp: string, feedPath: string): Promise<AppleFeedResponse> {
  const url = `${WB_BASE}/${timestamp}if_/https://${feedPath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from Wayback: ${url}`);
  return res.json() as Promise<AppleFeedResponse>;
}

function parseArgs(): { weeks: number; preview: boolean } {
  const args = process.argv.slice(2);
  const weeksArg = args.find((a) => a.startsWith('--weeks='));
  if (!weeksArg) {
    console.error('Usage: tsx seedHistoricalCharts.ts --weeks=N [--preview]');
    process.exit(1);
  }
  const weeks = parseInt(weeksArg.split('=')[1], 10);
  if (isNaN(weeks) || weeks < 1) {
    console.error('--weeks must be a positive integer');
    process.exit(1);
  }
  return { weeks, preview: args.includes('--preview') };
}

async function main(): Promise<void> {
  const { weeks, preview } = parseArgs();

  const fromDate = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000);

  console.log('Source: Wayback Machine (web.archive.org)');
  console.log(`  songs feed:  ${SONGS_PATH}`);
  console.log(`  albums feed: ${ALBUMS_PATH}`);
  console.log(`\nDiscovering snapshots from ${fromDate.toISOString().slice(0, 10)} (${weeks} weeks back)...`);

  const [songMap, albumMap] = await Promise.all([
    queryCdx(SONGS_PATH, fromDate),
    queryCdx(ALBUMS_PATH, fromDate),
  ]);

  // Merge: collect all weekDates that appear in either map
  const allWeekDates = new Set([...songMap.keys(), ...albumMap.keys()]);
  const sortedWeeks = [...allWeekDates].sort();

  if (sortedWeeks.length === 0) {
    console.log('\nWayback Machine has no snapshots for these feeds in that date range.');
    console.log('Try a smaller --weeks value or check the CDX API directly.');
    return;
  }

  console.log(`\nAvailable weeks (${sortedWeeks.length} found):`);
  for (const w of sortedWeeks) {
    const hasSongs  = songMap.has(w)  ? '✓' : '—';
    const hasAlbums = albumMap.has(w) ? '✓' : '—';
    console.log(`  ${w}  songs ${hasSongs}  albums ${hasAlbums}`);
  }

  // Preview: fetch and display the first available week's top 10 songs, then exit
  if (preview) {
    const sampleWeek = sortedWeeks[0];
    const sampleTs = songMap.get(sampleWeek) ?? albumMap.get(sampleWeek)!;
    if (songMap.has(sampleWeek)) {
      console.log(`\nSample — songs week of ${sampleWeek} (top 10):`);
      try {
        const data = await fetchArchived(sampleTs, SONGS_PATH);
        for (let i = 0; i < Math.min(10, data.feed.results.length); i++) {
          const e = data.feed.results[i];
          console.log(`  #${i + 1}  ${e.name} — ${e.artistName}`);
        }
      } catch (err) {
        console.error('  Could not fetch sample:', err);
      }
    }
    console.log(`\nRe-run safe: @@unique([weekDate, chart, rank]) upserts in place.`);
    console.log(`Run without --preview to load all ${sortedWeeks.length} weeks.`);
    return;
  }

  // Full load
  console.log(`\nLoading ${sortedWeeks.length} weeks...\n`);
  let loaded = 0;
  let failed = 0;

  for (const weekStr of sortedWeeks) {
    const weekDate = new Date(weekStr + 'T00:00:00.000Z');
    console.log(`--- ${weekStr} ---`);

    const songTs  = songMap.get(weekStr);
    const albumTs = albumMap.get(weekStr);

    if (songTs) {
      try {
        const data = await fetchArchived(songTs, SONGS_PATH);
        await ingestSongsFromFeed(data, weekDate);
      } catch (err) {
        console.error(`[songs] Failed for ${weekStr}:`, err);
        failed++;
      }
    }

    if (albumTs) {
      try {
        const data = await fetchArchived(albumTs, ALBUMS_PATH);
        await ingestAlbumsFromFeed(data, weekDate);
      } catch (err) {
        console.error(`[albums] Failed for ${weekStr}:`, err);
        failed++;
      }
    }

    loaded++;
    if (loaded < sortedWeeks.length) await sleep(2000);
  }

  console.log(`\nDone. ${loaded} weeks processed, ${failed} fetch errors.`);
}

main()
  .catch((err) => { console.error('Fatal:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
