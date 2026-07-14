import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma', () => ({
  prisma: {
    artist: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    chartEntry: { upsert: vi.fn(), deleteMany: vi.fn() },
    albumChartEntry: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { prisma } from '../../db/prisma';
import { ingestSongsFromFeed, resolveCreditedArtists, type AppleFeedResponse } from '../../jobs/ingestCharts';

const pm = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const WEEK = new Date('2026-07-07T00:00:00Z');

function feed(entries: Array<Partial<AppleFeedResponse['feed']['results'][0]>>): AppleFeedResponse {
  return {
    feed: {
      results: entries.map((e, i) => ({
        id: `${1000 + i}`,
        name: `Song ${i + 1}`,
        artistName: 'Solo Artist',
        artistId: `${2000 + i}`,
        genres: [{ name: 'Pop', genreId: '14' }],
        artworkUrl100: '',
        ...e,
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pm.artist.findUnique.mockResolvedValue(null);
  pm.artist.findFirst.mockResolvedValue(null);
  // create returns a row whose id encodes the name, so entries are attributable
  pm.artist.create.mockImplementation(async ({ data }: any) => ({ id: `id:${data.name}`, ...data }));
  pm.chartEntry.deleteMany.mockResolvedValue({ count: 0 });
  pm.chartEntry.upsert.mockResolvedValue({});
});

describe('resolveCreditedArtists', () => {
  it('single credit uses the appleArtistId path', async () => {
    const [entry] = feed([{ artistName: 'Don Toliver' }]).feed.results;
    const artists = await resolveCreditedArtists(entry);
    expect(artists).toHaveLength(1);
    expect(pm.artist.findUnique).toHaveBeenCalledWith({ where: { appleArtistId: BigInt(entry.artistId) } });
    expect(pm.artist.create.mock.calls[0][0].data.appleArtistId).toBe(BigInt(entry.artistId));
  });

  it('joint credit upserts each component by name without the apple id, and no combined row', async () => {
    const [entry] = feed([{ artistName: 'Kanye West & Don Toliver' }]).feed.results;
    const artists = await resolveCreditedArtists(entry);

    expect(artists.map((a) => a.id)).toEqual(['id:Kanye West', 'id:Don Toliver']);
    const createdNames = pm.artist.create.mock.calls.map((c) => c[0].data.name);
    expect(createdNames).toEqual(['Kanye West', 'Don Toliver']); // never 'Kanye West & Don Toliver'
    for (const call of pm.artist.create.mock.calls) {
      expect(call[0].data.appleArtistId).toBeUndefined();
      expect(call[0].data.genreEnrichedAt).toBeUndefined(); // left null → re-enriched by name search
    }
    // The combined credit's apple id is never looked up or attached
    expect(pm.artist.findUnique).not.toHaveBeenCalled();
  });

  it('reuses an existing component row instead of creating a duplicate', async () => {
    const [entry] = feed([{ artistName: 'Kanye West & Don Toliver' }]).feed.results;
    pm.artist.findFirst.mockImplementation(async ({ where }: any) =>
      where.name === 'Don Toliver' ? { id: 'existing-don', name: 'Don Toliver', imageUrl: 'x' } : null,
    );
    const artists = await resolveCreditedArtists(entry);
    expect(artists.map((a) => a.id)).toEqual(['id:Kanye West', 'existing-don']);
    expect(pm.artist.create).toHaveBeenCalledTimes(1); // only Kanye created
  });
});

describe('ingestSongsFromFeed', () => {
  it('writes one chart entry per credited artist on the 4-column unique', async () => {
    await ingestSongsFromFeed(feed([{ artistName: 'Kanye West & Don Toliver', name: 'Joint Song' }]), WEEK);

    expect(pm.chartEntry.upsert).toHaveBeenCalledTimes(2);
    const wheres = pm.chartEntry.upsert.mock.calls.map((c) => c[0].where.weekDate_chart_rank_artistId);
    expect(wheres).toEqual([
      { weekDate: WEEK, chart: 'most-played-songs', rank: 1, artistId: 'id:Kanye West' },
      { weekDate: WEEK, chart: 'most-played-songs', rank: 1, artistId: 'id:Don Toliver' },
    ]);
    for (const call of pm.chartEntry.upsert.mock.calls) {
      expect(call[0].create.songTitle).toBe('Joint Song');
    }
  });

  it('deletes stale rows at the rank that are null or not in the credited set', async () => {
    await ingestSongsFromFeed(feed([{ artistName: 'Kanye West & Don Toliver' }]), WEEK);

    expect(pm.chartEntry.deleteMany).toHaveBeenCalledWith({
      where: {
        weekDate: WEEK,
        chart: 'most-played-songs',
        rank: 1,
        OR: [{ artistId: null }, { artistId: { notIn: ['id:Kanye West', 'id:Don Toliver'] } }],
      },
    });
    // cleanup runs before the writes
    expect(pm.chartEntry.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      pm.chartEntry.upsert.mock.invocationCallOrder[0],
    );
  });

  it('single credit writes exactly one row', async () => {
    await ingestSongsFromFeed(feed([{ artistName: 'Solo Artist' }]), WEEK);
    expect(pm.chartEntry.upsert).toHaveBeenCalledTimes(1);
    expect(pm.chartEntry.upsert.mock.calls[0][0].create.artistId).toBe('id:Solo Artist');
  });

  it('skips the rank without writing when no artist resolves', async () => {
    pm.artist.create.mockRejectedValue(new Error('db down'));
    await ingestSongsFromFeed(feed([{ artistName: 'Solo Artist' }]), WEEK);
    expect(pm.chartEntry.upsert).not.toHaveBeenCalled();
    expect(pm.chartEntry.deleteMany).not.toHaveBeenCalled();
  });
});
