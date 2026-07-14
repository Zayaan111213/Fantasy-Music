import { prisma } from '../db/prisma';
import { getCurrentWeekDate, fetchFeed, ingestSongsFromFeed, ingestAlbumsFromFeed } from './ingestCharts';
import { runBackfill } from './backfillGenres';
import { runImageBackfill } from './backfillArtistImages';
import { scoreAllArtistsForWeek, updateMatchupScores } from '../scoring/engine';

const SONGS_URL  = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/songs.json';
const ALBUMS_URL = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/albums.json';

export async function runDailyPipeline(): Promise<void> {
  const weekDate = getCurrentWeekDate();
  console.log(`[daily] week of ${weekDate.toISOString().slice(0, 10)}`);

  console.log('[daily] 1/4 chart ingest');
  const [songs, albums] = await Promise.all([fetchFeed(SONGS_URL), fetchFeed(ALBUMS_URL)]);
  await ingestSongsFromFeed(songs, weekDate);
  await ingestAlbumsFromFeed(albums, weekDate);

  console.log('[daily] 2/4 genre enrichment');
  await runBackfill();

  console.log('[daily] 3/4 image backfill');
  await runImageBackfill();

  console.log('[daily] 4/4 score');
  const leagues = await prisma.league.findMany({
    where: { status: 'active' },
    select: { id: true, currentWeek: true },
  });

  if (leagues.length) {
    // Scores are keyed by calendar chart week, shared by every league.
    await scoreAllArtistsForWeek(weekDate);
    await Promise.all(
      leagues.map(({ id, currentWeek: week }) => updateMatchupScores(id, week, weekDate)),
    );
    console.log(`[daily] scored ${leagues.length} league(s)`);
  } else {
    console.log('[daily] no active leagues');
  }

  console.log('[daily] done');
}

if (require.main === module) {
  runDailyPipeline()
    .catch((err) => { console.error('[daily] fatal:', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
