import { describe, it, expect } from 'vitest';
import { buildRoundRobin } from '../../utils/schedule';

// Helper: count games for a specific teamId across all matchups
function gamesFor(matchups: ReturnType<typeof buildRoundRobin>, teamId: string): number {
  return matchups.filter((m) => m.homeTeamId === teamId || m.awayTeamId === teamId).length;
}

// Helper: canonical pair key (smaller id first)
function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

describe('buildRoundRobin', () => {
  describe('4 teams, 10 weeks', () => {
    const teams = ['t1', 't2', 't3', 't4'];
    const matchups = buildRoundRobin(teams, 'league-1', 10);

    it('produces exactly 20 matchups (2 per week × 10 weeks)', () => {
      expect(matchups).toHaveLength(20);
    });

    it('every matchup has the correct leagueId', () => {
      expect(matchups.every((m) => m.leagueId === 'league-1')).toBe(true);
    });

    it('week numbers span 1 through 10', () => {
      const weeks = new Set(matchups.map((m) => m.week));
      for (let w = 1; w <= 10; w++) expect(weeks.has(w)).toBe(true);
    });

    it('every team plays exactly 10 games', () => {
      for (const t of teams) {
        expect(gamesFor(matchups, t)).toBe(10);
      }
    });

    it('no team plays itself', () => {
      expect(matchups.every((m) => m.homeTeamId !== m.awayTeamId)).toBe(true);
    });

    it('each unique pair plays 3 or 4 times across 10 weeks', () => {
      const pairCounts = new Map<string, number>();
      for (const m of matchups) {
        const key = pairKey(m.homeTeamId, m.awayTeamId);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
      // 4 teams → 6 unique pairs; 10 games/team → 20 total games → ~3.3 per pair
      for (const [, count] of pairCounts) {
        expect(count).toBeGreaterThanOrEqual(3);
        expect(count).toBeLessThanOrEqual(4);
      }
    });

    it('each week has exactly 2 matchups', () => {
      for (let w = 1; w <= 10; w++) {
        expect(matchups.filter((m) => m.week === w)).toHaveLength(2);
      }
    });

    it('week 1 puts t1 vs t4 and t2 vs t3 (pin-0 rotation start)', () => {
      const w1 = matchups.filter((m) => m.week === 1);
      const pairs = w1.map((m) => pairKey(m.homeTeamId, m.awayTeamId));
      expect(pairs).toContain(pairKey('t1', 't4'));
      expect(pairs).toContain(pairKey('t2', 't3'));
    });
  });

  describe('2 teams, 10 weeks', () => {
    const matchups = buildRoundRobin(['a', 'b'], 'league-2', 10);

    it('produces exactly 10 matchups', () => {
      expect(matchups).toHaveLength(10);
    });

    it('every matchup is always the same pair', () => {
      expect(matchups.every((m) => pairKey(m.homeTeamId, m.awayTeamId) === pairKey('a', 'b'))).toBe(true);
    });

    it('each team plays 10 games', () => {
      expect(gamesFor(matchups, 'a')).toBe(10);
      expect(gamesFor(matchups, 'b')).toBe(10);
    });
  });

  describe('5 teams, 10 weeks (odd count → weekly bye)', () => {
    const teams = ['t1', 't2', 't3', 't4', 't5'];
    const matchups = buildRoundRobin(teams, 'league-odd', 10);

    it('each week has exactly 2 matchups (one team on bye)', () => {
      for (let w = 1; w <= 10; w++) {
        expect(matchups.filter((m) => m.week === w)).toHaveLength(2);
      }
    });

    it('no team plays itself', () => {
      expect(matchups.every((m) => m.homeTeamId !== m.awayTeamId)).toBe(true);
    });

    it('byes are distributed evenly: every team plays exactly 8 of 10 weeks', () => {
      for (const t of teams) {
        expect(gamesFor(matchups, t)).toBe(8);
      }
    });

    it('byes rotate through all 5 teams within the first 5 weeks (no team repeats before all have sat out once)', () => {
      const byeTeamByWeek = new Map<number, string>();
      for (let w = 1; w <= 5; w++) {
        const playing = new Set(
          matchups.filter((m) => m.week === w).flatMap((m) => [m.homeTeamId, m.awayTeamId]),
        );
        const bye = teams.find((t) => !playing.has(t))!;
        byeTeamByWeek.set(w, bye);
      }
      expect(new Set(byeTeamByWeek.values()).size).toBe(5);
    });
  });

  describe('3 teams, 9 weeks (odd count, exact multiple of cycle length)', () => {
    const teams = ['t1', 't2', 't3'];
    const matchups = buildRoundRobin(teams, 'league-odd3', 9);

    it('every team gets exactly 3 byes (plays 6 of 9 weeks)', () => {
      for (const t of teams) {
        expect(gamesFor(matchups, t)).toBe(6);
      }
    });
  });

  describe('does not mutate the input array', () => {
    it('original teamIds array is unchanged after call', () => {
      const original = ['x', 'y', 'z', 'w'];
      const copy = [...original];
      buildRoundRobin(original, 'league-x', 4);
      expect(original).toEqual(copy);
    });
  });
});
