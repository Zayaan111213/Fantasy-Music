import type { DataProvider } from './provider';

function seededRandom(seed: string, index: number = 0): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  h = (h + index * 2654435761) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

export class MockDataProvider implements DataProvider {
  async getWeeklyStreams(artistId: string, week: number, _year: number): Promise<number | null> {
    const popularity = seededRandom(artistId + '-pop', 0);
    const base = popularity * 60_000_000;
    const variance = (seededRandom(artistId + '-streams', week) - 0.5) * 0.4;
    return Math.max(0, Math.round(base * (1 + variance)));
  }

  async getBestChartPosition(artistId: string, week: number, _year: number): Promise<number | null> {
    const onChart = seededRandom(artistId + '-onChart', week);
    if (onChart >= 0.6) return null;
    const r = seededRandom(artistId + '-chart', week);
    return Math.floor(r * 100) + 1;
  }

  async getChartMovement(artistId: string, week: number, _year: number): Promise<number | null> {
    if (week <= 1) return null;
    const curOnChart = seededRandom(artistId + '-onChart', week);
    const prevOnChart = seededRandom(artistId + '-onChart', week - 1);
    if (curOnChart >= 0.6 || prevOnChart >= 0.6) return null;
    const isNewEntry = seededRandom(artistId + '-newEntry', week) < 0.1;
    if (isNewEntry) return null;
    const cur = Math.floor(seededRandom(artistId + '-chart', week) * 100) + 1;
    const prev = Math.floor(seededRandom(artistId + '-chart', week - 1) * 100) + 1;
    return prev - cur;
  }
}

export const mockDataProvider = new MockDataProvider();
