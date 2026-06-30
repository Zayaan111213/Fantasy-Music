// Pure round-robin schedule generator shared by draft.ts and testHelperRoutes.ts.
// Pins index 0 and rotates the remaining teams one step right each week.
export function buildRoundRobin(
  teamIds: string[],
  leagueId: string,
  weeks: number,
): { leagueId: string; week: number; homeTeamId: string; awayTeamId: string }[] {
  const ids = [...teamIds];
  const matchups: { leagueId: string; week: number; homeTeamId: string; awayTeamId: string }[] = [];
  for (let week = 1; week <= weeks; week++) {
    for (let i = 0; i < Math.floor(ids.length / 2); i++) {
      const j = ids.length - 1 - i;
      if (i !== j) matchups.push({ leagueId, week, homeTeamId: ids[i], awayTeamId: ids[j] });
    }
    ids.splice(1, 0, ids.pop()!);
  }
  return matchups;
}
