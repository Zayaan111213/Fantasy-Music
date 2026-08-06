import type { League } from '../api/types';

export type WeekPhase = 'pre_season' | 'adjustment' | 'scoring' | 'complete';

// Client-side mirror of isLineupLocked() in the backend's scoring/weeks.ts.
// 'adjustment' is the window where the lineup is editable and pickups are
// instant free agency rather than queued waiver claims.
export function getWeekPhase(league: League): WeekPhase {
  if (league.status === 'complete') return 'complete';
  if (league.status !== 'active') return 'pre_season';
  const dayPT = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' });
  if (dayPT === 'Monday') return 'adjustment';

  // Week 1 only: adjustment until the first Tuesday after the draft ends.
  // Compares YYYY-MM-DD strings (en-CA locale) for safe lexicographic date comparison.
  if (league.currentWeek === 1 && league.draftTime) {
    const draft = new Date(league.draftTime);
    const draftDow = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
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
