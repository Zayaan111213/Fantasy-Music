import { describe, it, expect } from 'vitest';
import { minDraftTime } from '../../utils/draftTime';

describe('minDraftTime', () => {
  it('is exactly 1 hour after a minute-aligned now', () => {
    const now = new Date('2026-07-27T15:00:00.000Z').getTime();
    expect(minDraftTime(now)).toEqual(new Date('2026-07-27T16:00:00.000Z'));
  });

  it('floors sub-minute now to the start of the minute before adding 1 hour', () => {
    const now = new Date('2026-07-27T15:00:47.500Z').getTime();
    expect(minDraftTime(now)).toEqual(new Date('2026-07-27T16:00:00.000Z'));
  });

  it('a draft time picked at the earliest allowed minute is never rejected by elapsed seconds within the same minute', () => {
    const pageLoadTime = new Date('2026-07-27T15:00:03.000Z').getTime();
    const earliestAllowed = minDraftTime(pageLoadTime);

    // Simulate the user submitting a few seconds later, still within the same minute
    const submitTime = new Date('2026-07-27T15:00:41.000Z').getTime();
    expect(earliestAllowed < minDraftTime(submitTime)).toBe(false);
    expect(earliestAllowed.getTime() === minDraftTime(submitTime).getTime()).toBe(true);
  });
});
