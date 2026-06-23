import { prisma } from '../db/prisma';
import { getCurrentWeekDate, fetchFeed, ingestSongsFromFeed, ingestAlbumsFromFeed } from './ingestCharts';
import { runBackfill } from './backfillGenres';
import { scoreAllArtistsForWeek, updateMatchupScores } from '../scoring/engine';

const SONGS_URL  = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/songs.json';
const ALBUMS_URL = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/albums.json';

async function main(): Promise<void> {
  const weekDate = getCurrentWeekDate();
  console.log(`[daily] week of ${weekDate.toISOString().slice(0, 10)}`);

  console.log('[daily] 1/3 chart ingest');
  const [songs, albums] = await Promise.all([fetchFeed(SONGS_URL), fetchFeed(ALBUMS_URL)]);
  await ingestSongsFromFeed(songs, weekDate);
  await ingestAlbumsFromFeed(albums, weekDate);

  console.log('[daily] 2/3 genre enrichment');
  await runBackfill();

  console.log('[daily] 3/3 score');
  const leagues = await prisma.league.findMany({
    where: { status: 'active' },
    select: { id: true, currentWeek: true, seasonYear: true },
  });

  if (leagues.length) {
    const scored = new Set<string>();
    for (const { currentWeek: week, seasonYear: year } of leagues) {
      const key = `${week}/${year}`;
      if (!scored.has(key)) {
        await scoreAllArtistsForWeek(week, year, weekDate);
        scored.add(key);
      }
    }
    await Promise.all(
      leagues.map(({ id, currentWeek: week, seasonYear: year }) =>
        updateMatchupScores(id, week, year),
      ),
    );
    console.log(`[daily] scored ${leagues.length} league(s)`);
  } else {
    console.log('[daily] no active leagues');
  }

  console.log('[daily] done');
}

main()
  .catch((err) => { console.error('[daily] fatal:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
