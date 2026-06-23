import { prisma } from '../db/prisma';
import { getCurrentWeekDate, fetchFeed, ingestSongsFromFeed, ingestAlbumsFromFeed } from './ingestCharts';

const SONGS_URL  = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/songs.json';
const ALBUMS_URL = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/albums.json';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function runIfNeeded(): Promise<void> {
  const weekDate = getCurrentWeekDate();
  const existing = await prisma.chartEntry.findFirst({ where: { weekDate } });
  if (existing) {
    console.log(`[charts] week of ${weekDate.toISOString().slice(0, 10)} already loaded, skipping`);
    return;
  }
  console.log(`[charts] ingesting week of ${weekDate.toISOString().slice(0, 10)}...`);
  const [songs, albums] = await Promise.all([fetchFeed(SONGS_URL), fetchFeed(ALBUMS_URL)]);
  await ingestSongsFromFeed(songs, weekDate);
  await ingestAlbumsFromFeed(albums, weekDate);
  console.log('[charts] ingest complete');
}

export function startChartIngestionScheduler(): void {
  // Runs on startup and every 24 h so Friday's new chart data is picked up automatically.
  runIfNeeded().catch((err) => console.error('[charts] ingest error:', err));
  setInterval(() => {
    runIfNeeded().catch((err) => console.error('[charts] ingest error:', err));
  }, CHECK_INTERVAL_MS);
}
