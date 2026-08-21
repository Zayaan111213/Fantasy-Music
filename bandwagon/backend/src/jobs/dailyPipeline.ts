import { prisma } from '../db/prisma';
import { getCurrentWeekDate, fetchFeed, ingestSongsFromFeed, ingestAlbumsFromFeed } from './ingestCharts';
import { runBackfill } from './backfillGenres';
import { runImageBackfill } from './backfillArtistImages';
import { scoreAllArtistsForWeek, updateMatchupScores } from '../scoring/engine';
import { weekDateForLeagueWeek, isLineupLocked } from '../scoring/weeks';
import { captureLineupSnapshot } from '../roster/snapshot';

const SONGS_URL  = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/songs.json';
const ALBUMS_URL = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/albums.json';

// Freezes each team's lineup for the current week the first time the pipeline
// runs while that week's lineup is locked (Tue–Sun). Skipped on Mondays and in
// the week-1 pre-game window, when rosters are still editable — capturing then
// would freeze a half-set lineup, and the capture is write-once.
async function snapshotIfLocked(leagueId: string, week: number, draftTime: Date | null): Promise<void> {
  const now = new Date();
  const dayPT = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' });
  const todayPT = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  if (!isLineupLocked(dayPT, week, draftTime, todayPT)) return;

  const count = await captureLineupSnapshot(prisma, leagueId, week);
  if (count > 0) console.log(`[daily] league ${leagueId} — froze ${count} lineup spots for week ${week}`);
}

// True on Mondays (PT), the one day the pipeline runs outside the chart week
// getCurrentWeekDate() names: the Tue–Sun window closed at Sunday 23:59 and
// finalize has already frozen that week's matchup scores.
export function isChartWeekClosed(now: Date = new Date()): boolean {
  return now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' }) === 'Monday';
}

// opts.ingest forces the chart ingest + rescore on or off; by default it is on
// except for the closed week described above. A manual CLI run can override it
// with --ingest.
export async function runDailyPipeline(opts: { ingest?: boolean } = {}): Promise<void> {
  const weekDate = getCurrentWeekDate();
  // Re-ingesting a closed week rewrites the very WeeklyScore rows the matchup
  // page prints under a final score that was computed from their older values,
  // which is how a finished game ended up showing a box score that added up to
  // 132 beneath a 104 header. A week's chart data is whatever its last in-window
  // run (Sunday) saw — the same data the final score was built from.
  const ingest = opts.ingest ?? !isChartWeekClosed();
  console.log(`[daily] week of ${weekDate.toISOString().slice(0, 10)}${ingest ? '' : ' (closed — ingest skipped)'}`);

  if (ingest) {
    console.log('[daily] 1/4 chart ingest');
    const [songs, albums] = await Promise.all([fetchFeed(SONGS_URL), fetchFeed(ALBUMS_URL)]);
    await ingestSongsFromFeed(songs, weekDate);
    await ingestAlbumsFromFeed(albums, weekDate);
  } else {
    console.log('[daily] 1/4 chart ingest — skipped, that chart week is already final');
  }

  console.log('[daily] 2/4 genre enrichment');
  await runBackfill();

  console.log('[daily] 3/4 image backfill');
  await runImageBackfill();

  console.log('[daily] 4/4 score');
  const leagues = await prisma.league.findMany({
    where: { status: 'active' },
    select: { id: true, currentWeek: true, draftTime: true },
  });

  if (leagues.length) {
    // Scores are keyed by calendar chart week, shared by every league. Skipped
    // for a closed week for the same reason the ingest above is.
    if (ingest) await scoreAllArtistsForWeek(weekDate);
    await Promise.all(
      leagues.map(({ id, currentWeek: week, draftTime }) => {
        // The league's own week date, NOT the global chart week. On Mondays
        // finalize has already advanced currentWeek to the week that starts
        // tomorrow, while weekDate is still the week that just ended — stamping
        // that week's scores onto the new matchup is what made every score read
        // a week stale. The new week legitimately has no chart rows yet, so it
        // scores 0 until Tuesday's ingest, which is correct.
        const leagueWeekDate = weekDateForLeagueWeek({ draftTime, currentWeek: week }, week);
        if (leagueWeekDate.getTime() !== weekDate.getTime()) {
          console.log(
            `[daily] league ${id} week ${week} scores against ${leagueWeekDate.toISOString().slice(0, 10)}` +
            ` (chart week is ${weekDate.toISOString().slice(0, 10)})`,
          );
        }
        return snapshotIfLocked(id, week, draftTime).then(() => updateMatchupScores(id, week, leagueWeekDate));
      }),
    );
    console.log(`[daily] scored ${leagues.length} league(s)`);
  } else {
    console.log('[daily] no active leagues');
  }

  console.log('[daily] done');
}

if (require.main === module) {
  runDailyPipeline(process.argv.includes('--ingest') ? { ingest: true } : {})
    .catch((err) => { console.error('[daily] fatal:', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
