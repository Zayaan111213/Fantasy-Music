import { describe, it, expect } from 'vitest';

import { isChartWeekClosed } from '../../jobs/dailyPipeline';

// Monday PT is the one day the daily pipeline runs outside the chart week
// getCurrentWeekDate() names — the Tue–Sun window closed at Sunday 23:59 and
// finalize has already frozen that week's matchup scores. Re-ingesting it moves
// the per-artist numbers out from under the final score built from them.
describe('isChartWeekClosed', () => {
  it('is true on Monday PT', () => {
    // 2026-08-17T16:00:00Z = Monday 09:00 PT
    expect(isChartWeekClosed(new Date('2026-08-17T16:00:00Z'))).toBe(true);
  });

  it('is true just after midnight PT on Monday, when finalize runs', () => {
    // 2026-08-17T07:05:00Z = Monday 00:05 PDT
    expect(isChartWeekClosed(new Date('2026-08-17T07:05:00Z'))).toBe(true);
  });

  it('is false on the Sunday that closes the week', () => {
    // 2026-08-16T22:00:00Z = Sunday 15:00 PT — still inside the window
    expect(isChartWeekClosed(new Date('2026-08-16T22:00:00Z'))).toBe(false);
  });

  it('is false late Monday UTC that is still Sunday in PT', () => {
    // 2026-08-17T05:00:00Z = Sunday 22:00 PDT
    expect(isChartWeekClosed(new Date('2026-08-17T05:00:00Z'))).toBe(false);
  });

  it('is false on Tuesday, when the new chart week opens', () => {
    expect(isChartWeekClosed(new Date('2026-08-18T16:00:00Z'))).toBe(false);
  });
});
