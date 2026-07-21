// Pure round-robin schedule generator shared by draft.ts and testHelperRoutes.ts.
// Pins index 0 and rotates the remaining teams one step right each week.
//
// Odd team counts get a bye each week. To spread byes evenly (rather than
// always exempting whichever team is pinned), a BYE sentinel is prepended
// and pinned in its place instead — every real team then rotates through
// the "paired with BYE" slot over an n-week cycle, one bye each.
export function buildRoundRobin(
  teamIds: string[],
  leagueId: string,
  weeks: number,
): { leagueId: string; week: number; homeTeamId: string; awayTeamId: string }[] {
  const BYE = null;
  const isOdd = teamIds.length % 2 !== 0;
  const ids: (string | null)[] = isOdd ? [BYE, ...teamIds] : [...teamIds];
  const matchups: { leagueId: string; week: number; homeTeamId: string; awayTeamId: string }[] = [];
  for (let week = 1; week <= weeks; week++) {
    for (let i = 0; i < Math.floor(ids.length / 2); i++) {
      const j = ids.length - 1 - i;
      const home = ids[i];
      const away = ids[j];
      if (i !== j && home !== null && away !== null) {
        matchups.push({ leagueId, week, homeTeamId: home, awayTeamId: away });
      }
    }
    ids.splice(1, 0, ids.pop()!);
  }
  return matchups;
}
