import type { League } from '@bandwagon/shared';

export type WeekPhase = 'pre_season' | 'adjustment' | 'scoring' | 'complete';

// Ported verbatim from frontend/src/pages/LeagueHub.tsx's getWeekPhase —
// keep in sync if lineup-lock rules change (see also backend's mirror in
// api/routes/leagues.ts, per CLAUDE.md).
export function getWeekPhase(league: League): WeekPhase {
  if (league.status === 'complete') return 'complete';
  if (league.status !== 'active') return 'pre_season';
  const dayPT = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' });
  if (dayPT === 'Monday') return 'adjustment';

  if (league.currentWeek === 1 && league.draftTime) {
    const draft = new Date(league.draftTime);
    const draftDow = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      .indexOf(draft.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' }));
    const daysToTuesday = draftDow === 2 ? 7 : (2 - draftDow + 7) % 7;
    const firstTuesdayApprox = new Date(draft);
    firstTuesdayApprox.setDate(draft.getDate() + daysToTuesday);
    const todayPT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const firstTuesdayPT = firstTuesdayApprox.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    if (todayPT < firstTuesdayPT) return 'adjustment';
  }

  return 'scoring';
}

export const REGULAR_SEASON_WEEKS = 10;
export const PLAYOFF_FINAL_WEEK = 12;
