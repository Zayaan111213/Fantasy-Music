import { prisma } from '../db/prisma';
import { getCurrentWeekDate, fetchFeed, ingestSongsFromFeed, ingestAlbumsFromFeed } from './ingestCharts';
import { scoreAllArtistsForWeek, updateMatchupScores } from '../scoring/engine';

const SONGS_URL  = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/songs.json';
const ALBUMS_URL = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/albums.json';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function run(): Promise<void> {
  const weekDate = getCurrentWeekDate();
  console.log(`[charts] ingesting week of ${weekDate.toISOString().slice(0, 10)}...`);

  const [songs, albums] = await Promise.all([fetchFeed(SONGS_URL), fetchFeed(ALBUMS_URL)]);
  await ingestSongsFromFeed(songs, weekDate);
  await ingestAlbumsFromFeed(albums, weekDate);
  console.log('[charts] ingest complete');

  const activeLeagues = await prisma.league.findMany({
    where: { status: 'active' },
    select: { id: true, currentWeek: true },
  });
  if (!activeLeagues.length) {
    console.log('[charts] no active leagues, skipping scoring');
    return;
  }

  // Scores are keyed by calendar chart week, shared by every league.
  await scoreAllArtistsForWeek(weekDate);
  await Promise.all(
    activeLeagues.map(({ id, currentWeek: week }) => updateMatchupScores(id, week, weekDate))
  );
  console.log(`[charts] scored ${activeLeagues.length} active league(s)`);
}

export function startChartIngestionScheduler(): void {
  // Runs on startup and every 24 h. Re-ingests daily so provisional matchup scores
  // reflect the latest Apple chart positions (scoring week is Tue–Sun).
  run().catch((err) => console.error('[charts] ingest error:', err));
  setInterval(() => {
    run().catch((err) => console.error('[charts] ingest error:', err));
  }, CHECK_INTERVAL_MS);
}
