import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCurrentWeekDate } from '../../jobs/ingestCharts';

afterEach(() => vi.useRealTimers());

function setNow(isoUtc: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoUtc));
}

describe('getCurrentWeekDate', () => {
  it('returns a Tuesday (UTC day 2)', () => {
    setNow('2026-06-23T12:00:00Z'); // Tuesday 05:00 PDT
    expect(getCurrentWeekDate().getUTCDay()).toBe(2);
  });

  it('on Wednesday returns the previous Tuesday', () => {
    setNow('2026-06-24T12:00:00Z'); // Wednesday PDT
    expect(getCurrentWeekDate().toISOString().slice(0, 10)).toBe('2026-06-23');
  });

  it('on Thursday returns the previous Tuesday', () => {
    setNow('2026-06-25T12:00:00Z'); // Thursday PDT
    expect(getCurrentWeekDate().toISOString().slice(0, 10)).toBe('2026-06-23');
  });

  it('on Friday returns the previous Tuesday', () => {
    setNow('2026-06-26T12:00:00Z'); // Friday PDT
    expect(getCurrentWeekDate().toISOString().slice(0, 10)).toBe('2026-06-23');
  });

  it('on Saturday returns the previous Tuesday', () => {
    setNow('2026-06-27T12:00:00Z'); // Saturday PDT
    expect(getCurrentWeekDate().toISOString().slice(0, 10)).toBe('2026-06-23');
  });

  it('on Sunday returns 5 days back (last Tuesday)', () => {
    setNow('2026-06-28T12:00:00Z'); // Sunday PDT
    expect(getCurrentWeekDate().toISOString().slice(0, 10)).toBe('2026-06-23');
  });

  it('on Monday returns 6 days back (last Tuesday)', () => {
    setNow('2026-06-29T12:00:00Z'); // Monday PDT
    expect(getCurrentWeekDate().toISOString().slice(0, 10)).toBe('2026-06-23');
  });

  // Pacific timezone edge case (PDT = UTC-7):
  // 06:00 UTC on Tuesday = 23:00 Monday Pacific → should return PREVIOUS Tuesday
  it('UTC Tuesday midnight that is still Monday in Pacific returns prior Tuesday (PDT)', () => {
    setNow('2026-06-23T06:00:00Z'); // Tuesday 06:00 UTC = Monday 23:00 PDT
    expect(getCurrentWeekDate().toISOString().slice(0, 10)).toBe('2026-06-16');
  });

  // Pacific timezone edge case (PST = UTC-8):
  // 07:30 UTC on Jan 6 = 23:30 Dec 30 PST (actually Jan 5 23:30 PST) → prior Tuesday
  it('UTC Tuesday morning that is still Monday in Pacific returns prior Tuesday (PST)', () => {
    setNow('2026-01-06T07:30:00Z'); // Tuesday 07:30 UTC = Monday 23:30 PST
    expect(getCurrentWeekDate().toISOString().slice(0, 10)).toBe('2025-12-30');
  });

  it('on Tuesday at 14:00 UTC (07:00 PDT) the result IS that Tuesday', () => {
    setNow('2026-06-23T14:00:00Z'); // clearly Tuesday Pacific
    expect(getCurrentWeekDate().toISOString().slice(0, 10)).toBe('2026-06-23');
  });

  it('result is always midnight UTC (00:00:00)', () => {
    setNow('2026-06-24T20:00:00Z'); // Wednesday evening
    const d = getCurrentWeekDate();
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
  });
});
