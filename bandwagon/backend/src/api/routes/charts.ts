import { Router } from 'express';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

export interface ChartRowOut {
  rank: number;
  title: string;
  artists: { id: string; name: string; imageUrl: string | null }[];
  lastWeekRank: number | null;
  delta: number | null; // positive = climbed since last week
  isNew: boolean;
}

interface RawRow {
  rank: number;
  title: string;
  appleId: bigint | null;
  artist: { id: string; name: string; imageUrl: string | null } | null;
}

// Multi-artist songs/albums are stored once per credited artist (same rank +
// title), so a chart is rebuilt by grouping rows on rank. Movement matches the
// prior week by Apple catalog id when present, else by title.
function assemble(cur: RawRow[], prev: RawRow[]): ChartRowOut[] {
  const prevByApple = new Map<string, number>();
  const prevByTitle = new Map<string, number>();
  for (const r of prev) {
    if (r.appleId != null) {
      const k = r.appleId.toString();
      if (!prevByApple.has(k) || prevByApple.get(k)! > r.rank) prevByApple.set(k, r.rank);
    }
    const t = r.title.toLowerCase();
    if (!prevByTitle.has(t) || prevByTitle.get(t)! > r.rank) prevByTitle.set(t, r.rank);
  }

  const byRank = new Map<number, { rank: number; title: string; appleId: bigint | null; artists: ChartRowOut['artists'] }>();
  for (const r of cur) {
    let row = byRank.get(r.rank);
    if (!row) {
      row = { rank: r.rank, title: r.title, appleId: r.appleId, artists: [] };
      byRank.set(r.rank, row);
    }
    if (r.artist && !row.artists.some((a) => a.id === r.artist!.id)) row.artists.push(r.artist);
  }

  return [...byRank.values()]
    .sort((a, b) => a.rank - b.rank)
    .map((row) => {
      const lastWeekRank =
        (row.appleId != null ? prevByApple.get(row.appleId.toString()) : undefined) ??
        prevByTitle.get(row.title.toLowerCase()) ??
        null;
      return {
        rank: row.rank,
        title: row.title,
        artists: row.artists,
        lastWeekRank,
        delta: lastWeekRank != null ? lastWeekRank - row.rank : null,
        isNew: lastWeekRank == null,
      };
    });
}

const ARTIST_SELECT = { select: { id: true, name: true, imageUrl: true } };

async function buildCharts(weekDate: Date): Promise<{ songs: ChartRowOut[]; albums: ChartRowOut[] }> {
  const prior = new Date(weekDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [curSongs, prevSongs, curAlbums, prevAlbums] = await Promise.all([
    prisma.chartEntry.findMany({ where: { weekDate }, include: { artist: ARTIST_SELECT }, orderBy: { rank: 'asc' } }),
    prisma.chartEntry.findMany({ where: { weekDate: prior } }),
    prisma.albumChartEntry.findMany({ where: { weekDate }, include: { artist: ARTIST_SELECT }, orderBy: { rank: 'asc' } }),
    prisma.albumChartEntry.findMany({ where: { weekDate: prior } }),
  ]);
  return {
    songs: assemble(
      curSongs.map((r) => ({ rank: r.rank, title: r.songTitle, appleId: r.appleSongId, artist: r.artist })),
      prevSongs.map((r) => ({ rank: r.rank, title: r.songTitle, appleId: r.appleSongId, artist: null })),
    ),
    albums: assemble(
      curAlbums.map((r) => ({ rank: r.rank, title: r.albumTitle, appleId: r.appleAlbumId, artist: r.artist })),
      prevAlbums.map((r) => ({ rank: r.rank, title: r.albumTitle, appleId: r.appleAlbumId, artist: null })),
    ),
  };
}

// Latest chart week with data — normally the current scoring week, but falls
// back gracefully if a new week's ingest hasn't run yet.
async function latestChartWeek(): Promise<Date | null> {
  const row = await prisma.chartEntry.findFirst({ orderBy: { weekDate: 'desc' }, select: { weekDate: true } });
  return row?.weekDate ?? null;
}

router.get('/', requireAuth, async (_req, res, next) => {
  try {
    const weekDate = await latestChartWeek();
    if (!weekDate) {
      res.json({ weekDate: null, songs: [], albums: [] });
      return;
    }
    const { songs, albums } = await buildCharts(weekDate);
    res.json({ weekDate: weekDate.toISOString().slice(0, 10), songs, albums });
  } catch (err) {
    next(err);
  }
});

function movers(rows: ChartRowOut[], limit: number) {
  const moved = rows.filter((r) => r.delta != null);
  return {
    risers: moved.filter((r) => r.delta! > 0).sort((a, b) => b.delta! - a.delta!).slice(0, limit),
    fallers: moved.filter((r) => r.delta! < 0).sort((a, b) => a.delta! - b.delta!).slice(0, limit),
  };
}

router.get('/movers', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '4'), 10) || 4, 10);
    const weekDate = await latestChartWeek();
    if (!weekDate) {
      res.json({ weekDate: null, songs: { risers: [], fallers: [] }, albums: { risers: [], fallers: [] } });
      return;
    }
    const { songs, albums } = await buildCharts(weekDate);
    res.json({
      weekDate: weekDate.toISOString().slice(0, 10),
      songs: movers(songs, limit),
      albums: movers(albums, limit),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
