import { describe, it, expect, vi } from 'vitest';

// splitCombinedArtists pulls in trades/engine → api/routes/leagues (and the
// draft route for ALL_SLOTS) — stub prisma and multer like trades.test.ts.
vi.mock('../../db/prisma', () => ({ prisma: {} }));
vi.mock('../../api/middleware/upload', () => ({
  uploadTeamLogo: (_req: any, _res: any, next: any) => next(),
  uploadAvatar: (_req: any, _res: any, next: any) => next(),
}));

import { chooseReplacement } from '../../jobs/splitCombinedArtists';

const KANYE = { id: 'kanye', primaryGenre: 'R&B/Hip-Hop' };
const DON = { id: 'don', primaryGenre: 'R&B/Hip-Hop' };

describe('chooseReplacement', () => {
  it('picks the first-listed component when it is available', () => {
    const result = chooseReplacement([KANYE, DON], new Set(), []);
    expect(result?.artist.id).toBe('kanye');
    // Lands in an eligible slot
    const slot = [...result!.assignment.entries()].find(([, id]) => id === 'kanye')![0];
    expect(['R&B/Hip-Hop', 'Flex', 'Bench-1', 'Bench-2', 'Bench-3']).toContain(slot);
  });

  it('falls back to the next component when the first is rostered in the league', () => {
    const result = chooseReplacement([KANYE, DON], new Set(['kanye']), []);
    expect(result?.artist.id).toBe('don');
  });

  it('returns null when every component is already rostered', () => {
    expect(chooseReplacement([KANYE, DON], new Set(['kanye', 'don']), [])).toBeNull();
  });

  it('shuffles kept artists to make room when the direct slot is occupied', () => {
    // Every slot filled except Pop; the candidate is Country, whose eligible
    // slots are all taken — but the Pop-genre artist parked in Flex can move
    // to the open Pop slot, freeing Flex.
    const keep = [
      { slot: 'R&B/Hip-Hop', artist: { id: 'a1', primaryGenre: 'R&B/Hip-Hop' } },
      { slot: 'Rock & Alternative', artist: { id: 'a2', primaryGenre: 'Rock & Alternative' } },
      { slot: 'Country', artist: { id: 'a3', primaryGenre: 'Country' } },
      { slot: 'Other', artist: { id: 'a4', primaryGenre: 'Latin' } },
      { slot: 'Flex', artist: { id: 'a5', primaryGenre: 'Pop' } },
      { slot: 'Bench-1', artist: { id: 'a6', primaryGenre: 'Pop' } },
      { slot: 'Bench-2', artist: { id: 'a7', primaryGenre: 'Pop' } },
      { slot: 'Bench-3', artist: { id: 'a8', primaryGenre: 'Pop' } },
    ];
    const candidate = { id: 'tim', primaryGenre: 'Country' };

    const result = chooseReplacement([candidate], new Set(), keep);
    expect(result).not.toBeNull();
    const assignment = result!.assignment;
    expect([...assignment.values()]).toContain('tim');
    // Roster stays legal: 9 occupied slots, every keep still placed
    expect(assignment.size).toBe(9);
    for (const kept of keep) expect([...assignment.values()]).toContain(kept.artist.id);
  });

  it('returns null when no legal arrangement exists', () => {
    // All five Country-eligible slots (Country, Flex, Bench-1..3) are held by
    // Country artists that have nowhere else to go.
    const keep = [
      { slot: 'Country', artist: { id: 'c1', primaryGenre: 'Country' } },
      { slot: 'Flex', artist: { id: 'c2', primaryGenre: 'Country' } },
      { slot: 'Bench-1', artist: { id: 'c3', primaryGenre: 'Country' } },
      { slot: 'Bench-2', artist: { id: 'c4', primaryGenre: 'Country' } },
      { slot: 'Bench-3', artist: { id: 'c5', primaryGenre: 'Country' } },
    ];
    const candidate = { id: 'c6', primaryGenre: 'Country' };
    expect(chooseReplacement([candidate], new Set(), keep)).toBeNull();
  });
});
