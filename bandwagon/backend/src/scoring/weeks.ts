// Pure PT-calendar week math. Lives in its own module (no prisma import) so
// scoring/engine.ts can use the league-schedule anchor without importing
// jobs/finalizePipeline.ts — that file already reaches back into scoring via
// trades/engine → routes/leagues, and the cycle would bite at module init.

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Extracts the Pacific calendar Y/M/D of an instant. Everything downstream
// works in PT-calendar-date space projected onto Date.UTC, never on the
// process's local timezone — see firstScoringTuesdayPT's DST note.
function ptParts(d: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(d);
  return {
    year: parseInt(parts.find((p) => p.type === 'year')!.value),
    month: parseInt(parts.find((p) => p.type === 'month')!.value) - 1,
    day: parseInt(parts.find((p) => p.type === 'day')!.value),
  };
}

// The Tuesday that this league's week 1 scores against, as a UTC-midnight Date
// — the same shape as ChartEntry.weekDate / getCurrentWeekDate().
//
// Week-1 exception: there is no game between draft completion and the first
// Tuesday after draftTime, so league week 1 is that Tuesday's chart week. A
// draft that lands on a Tuesday pushes to the following one.
export function firstScoringTuesdayDate(draftTime: Date): Date {
  const { year, month, day } = ptParts(draftTime);
  const draftDow = new Date(Date.UTC(year, month, day)).getUTCDay(); // 0 = Sun … 6 = Sat
  const daysToTuesday = draftDow === 2 ? 7 : (2 - draftDow + 7) % 7;
  return new Date(Date.UTC(year, month, day + daysToTuesday));
}

// Returns the PT calendar date (YYYY-MM-DD) of the first scoring Tuesday after
// the draft. Used by isLineupLocked() in leagues.ts and the finalize week-1 gate.
//
// Computed entirely in PT-calendar-date space (extract Y/M/D, then Date.UTC
// arithmetic) rather than draftTime.getDate()/.setDate(), which operate in
// the process's local timezone. Adding N days that way and re-projecting
// through timeZone: 'America/Los_Angeles' breaks across a DST transition:
// a 7-UTC-day jump shifts PT wall-clock time by an hour, which can roll a
// near-midnight-PT draft time onto the wrong calendar date (verified: a
// 2026-10-27T07:30:00Z draft — Tue 12:30am PDT — landed on 2026-11-02
// instead of the correct 2026-11-03, since PT flips to PST on Nov 1).
export function firstScoringTuesdayPT(draftTime: Date): string {
  return firstScoringTuesdayDate(draftTime).toISOString().slice(0, 10);
}

// Returns true if lineup edits are forbidden right now — Tue–Sun of a scoring
// week. Also gates when a LineupSnapshot may be captured: a locked lineup is
// exactly the one that plays that week, so it's safe to freeze.
// dayPT: day-of-week name in Pacific time (e.g. 'Monday').
// todayPT: Pacific date string in 'YYYY-MM-DD' format.
export function isLineupLocked(
  dayPT: string,
  currentWeek: number,
  draftTime: Date | null,
  todayPT: string,
): boolean {
  if (dayPT === 'Monday') return false;

  // Week-1 exception: lineup stays open until the first scoring Tuesday after the draft.
  if (currentWeek === 1 && draftTime) {
    if (todayPT < firstScoringTuesdayPT(draftTime)) return false;
  }

  return true;
}

export interface LeagueWeekAnchor {
  draftTime: Date | null;
  currentWeek: number;
}

// Translates a league's week number to the real chart week (the Tuesday it
// scores against). WeeklyScore rows are keyed by calendar weekDate — league
// week numbers are per-league counters, and two leagues that started on
// different dates give the same number to different calendar weeks.
//
// Anchored on the league's OWN schedule (week 1 = the first scoring Tuesday
// after the draft), not on "the chart week containing today". The today-anchor
// was wrong for a full day every week: finalize advances currentWeek at Monday
// 00:01 PT, but getCurrentWeekDate() doesn't roll to the new Tuesday until
// Tuesday — so all Monday, every week resolved one chart week too early. It
// was wrong in the week-1 pre-game window (draft Wed → currentWeek 1, but
// week 1's charts don't start until the following Tuesday) for the same reason.
export function weekDateForLeagueWeek(league: LeagueWeekAnchor, week: number): Date {
  if (!league.draftTime) {
    // Undrafted leagues have no schedule to anchor on. Nothing scores before a
    // draft, so this only guards type-safety; fall back to the old relative math.
    return new Date(currentChartWeekDate().getTime() - (league.currentWeek - week) * WEEK_MS);
  }
  return new Date(firstScoringTuesdayDate(league.draftTime).getTime() + (week - 1) * WEEK_MS);
}

// The Tuesday of the chart week that TODAY falls in (PT). This is a property of
// the calendar, not of any league — it's what the ingest keys chart rows by.
// Duplicated from jobs/ingestCharts.getCurrentWeekDate() to keep this module
// prisma-free; the ingest one stays the canonical writer.
function currentChartWeekDate(now: Date = new Date()): Date {
  const { year, month, day } = ptParts(now);
  const ptDow = new Date(Date.UTC(year, month, day)).getUTCDay();
  const daysBack = (ptDow + 5) % 7; // Tue = 2 → (2+5)%7 = 0
  return new Date(Date.UTC(year, month, day - daysBack));
}
