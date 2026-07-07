import { prisma } from '../db/prisma';

export const PLAYOFF_SEMIS_WEEK = 11;
export const PLAYOFF_FINALS_WEEK = 12;
export const REGULAR_SEASON_WEEKS = 10;

export type SeededTeam = { teamId: string; seed: number };

export type PlayoffMatchupInput = {
  leagueId: string;
  week: number;
  matchupType: string;
  homeTeamId: string;
  awayTeamId: string;
  homeSeed: number;
  awaySeed: number;
};

export type FinalizedPlayoffMatchup = {
  matchupType: string;
  winnerId: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeSeed: number | null;
  awaySeed: number | null;
};

// Better (lower-number) seed is always home.
function game(
  leagueId: string,
  week: number,
  matchupType: string,
  a: SeededTeam,
  b: SeededTeam,
): PlayoffMatchupInput {
  const [home, away] = a.seed < b.seed ? [a, b] : [b, a];
  return {
    leagueId,
    week,
    matchupType,
    homeTeamId: home.teamId,
    awayTeamId: away.teamId,
    homeSeed: home.seed,
    awaySeed: away.seed,
  };
}

// Week 11 bracket by team count N:
//   N >= 4: semifinals 1v4 and 2v3
//   N = 6:  single 5v6 game decides 5th place outright
//   N = 7:  consolation semifinal 6v7; seed 5 gets a bye to the 5th place game
//   N >= 8: consolation semifinals 5v8 and 6v7 (seeds 9+ are done for the season)
// N < 4: no playoffs.
export function buildWeek11Matchups(leagueId: string, seeds: SeededTeam[]): PlayoffMatchupInput[] {
  if (seeds.length < 4) return [];
  const bySeed = new Map(seeds.map((s) => [s.seed, s]));
  const at = (n: number) => bySeed.get(n)!;

  const matchups = [
    game(leagueId, PLAYOFF_SEMIS_WEEK, 'semifinal', at(1), at(4)),
    game(leagueId, PLAYOFF_SEMIS_WEEK, 'semifinal', at(2), at(3)),
  ];

  if (seeds.length >= 8) {
    matchups.push(game(leagueId, PLAYOFF_SEMIS_WEEK, 'consolation_semifinal', at(5), at(8)));
    matchups.push(game(leagueId, PLAYOFF_SEMIS_WEEK, 'consolation_semifinal', at(6), at(7)));
  } else if (seeds.length === 7) {
    matchups.push(game(leagueId, PLAYOFF_SEMIS_WEEK, 'consolation_semifinal', at(6), at(7)));
  } else if (seeds.length === 6) {
    matchups.push(game(leagueId, PLAYOFF_SEMIS_WEEK, 'fifth_place', at(5), at(6)));
  }

  return matchups;
}

function winnerAndLoser(m: FinalizedPlayoffMatchup): { winner: SeededTeam; loser: SeededTeam } {
  if (!m.winnerId || m.homeSeed == null || m.awaySeed == null) {
    throw new Error(`playoff matchup missing winner or seeds (type ${m.matchupType})`);
  }
  const home: SeededTeam = { teamId: m.homeTeamId, seed: m.homeSeed };
  const away: SeededTeam = { teamId: m.awayTeamId, seed: m.awaySeed };
  return m.winnerId === m.homeTeamId ? { winner: home, loser: away } : { winner: away, loser: home };
}

// Week 12: semifinal winners meet in the Championship, semifinal losers in the
// 3rd Place Game. Consolation semifinal winners meet in the 5th Place Game and
// losers in the 7th Place Game (7-team leagues: seed 5's bye sends them straight
// to the 5th Place Game; the lone consolation loser finishes 7th with no game).
export function buildWeek12Matchups(
  leagueId: string,
  seeds: SeededTeam[],
  week11: FinalizedPlayoffMatchup[],
): PlayoffMatchupInput[] {
  const semis = week11.filter((m) => m.matchupType === 'semifinal');
  if (semis.length !== 2) {
    throw new Error(`expected 2 finalized semifinals for league ${leagueId}, found ${semis.length}`);
  }
  const [semiA, semiB] = semis.map(winnerAndLoser);

  const matchups = [
    game(leagueId, PLAYOFF_FINALS_WEEK, 'championship', semiA.winner, semiB.winner),
    game(leagueId, PLAYOFF_FINALS_WEEK, 'third_place', semiA.loser, semiB.loser),
  ];

  const consSemis = week11.filter((m) => m.matchupType === 'consolation_semifinal');
  if (consSemis.length === 2) {
    const [consA, consB] = consSemis.map(winnerAndLoser);
    matchups.push(game(leagueId, PLAYOFF_FINALS_WEEK, 'fifth_place', consA.winner, consB.winner));
    matchups.push(game(leagueId, PLAYOFF_FINALS_WEEK, 'seventh_place', consA.loser, consB.loser));
  } else if (consSemis.length === 1) {
    const cons = winnerAndLoser(consSemis[0]);
    const seedFive = seeds.find((s) => s.seed === 5);
    if (!seedFive) throw new Error(`league ${leagueId} has a consolation semifinal but no seed 5`);
    matchups.push(game(leagueId, PLAYOFF_FINALS_WEEK, 'fifth_place', seedFive, cons.winner));
  }

  return matchups;
}

// Final regular-season standings order — same sort as the standings endpoint,
// with createdAt as a deterministic last-resort tiebreaker.
export async function getFinalSeeds(leagueId: string): Promise<SeededTeam[]> {
  const teams = await prisma.team.findMany({
    where: { leagueId },
    select: { id: true },
    orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }, { createdAt: 'asc' }],
  });
  return teams.map((t, i) => ({ teamId: t.id, seed: i + 1 }));
}

// Creates the next playoff week's matchups after week 10 or 11 finalizes.
// Idempotent: no-ops if the target week already has matchups, and the
// (leagueId, week, homeTeamId) unique index + skipDuplicates backstop
// concurrent double-runs.
export async function ensurePlayoffMatchups(leagueId: string, completedWeek: number): Promise<void> {
  if (completedWeek !== REGULAR_SEASON_WEEKS && completedWeek !== PLAYOFF_SEMIS_WEEK) return;
  const targetWeek = completedWeek + 1;

  const existing = await prisma.matchup.findFirst({
    where: { leagueId, week: targetWeek },
    select: { id: true },
  });
  if (existing) return;

  const seeds = await getFinalSeeds(leagueId);

  if (completedWeek === REGULAR_SEASON_WEEKS) {
    if (seeds.length < 4) {
      // Too few teams for a bracket — the season ends with the regular season.
      await prisma.league.update({ where: { id: leagueId }, data: { status: 'complete' } });
      console.log(`[playoffs] league ${leagueId} has ${seeds.length} teams — no playoffs, season complete`);
      return;
    }
    const data = buildWeek11Matchups(leagueId, seeds);
    await prisma.matchup.createMany({ data, skipDuplicates: true });
    console.log(`[playoffs] league ${leagueId} — created ${data.length} week-${targetWeek} playoff matchups`);
  } else {
    const week11 = await prisma.matchup.findMany({
      where: { leagueId, week: PLAYOFF_SEMIS_WEEK, isFinalized: true, matchupType: { not: 'regular' } },
    });
    const data = buildWeek12Matchups(leagueId, seeds, week11);
    await prisma.matchup.createMany({ data, skipDuplicates: true });
    console.log(`[playoffs] league ${leagueId} — created ${data.length} week-${targetWeek} playoff matchups`);
  }
}
