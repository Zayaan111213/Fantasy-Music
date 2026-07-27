import { describe, it, expect } from 'vitest';
import { utcToPacificInputValue, pacificInputValueToUtcIso, formatPacific } from '../../utils/draftTime';

describe('pacificInputValueToUtcIso', () => {
  it('converts a PDT (summer) wall-clock time to the correct UTC instant', () => {
    // 10:00 PM Pacific Daylight Time (UTC-7) on July 27 = 5:00 AM UTC on July 28
    expect(pacificInputValueToUtcIso('2026-07-27T22:00')).toBe('2026-07-28T05:00:00.000Z');
  });

  it('converts a PST (winter) wall-clock time to the correct UTC instant', () => {
    // 10:00 PM Pacific Standard Time (UTC-8) on January 15 = 6:00 AM UTC on January 16
    expect(pacificInputValueToUtcIso('2026-01-15T22:00')).toBe('2026-01-16T06:00:00.000Z');
  });

  it('does not shift the calendar day when the picked time is well within the day', () => {
    // 2:16 PM PDT should still land on the same UTC date as far as the hour math goes
    expect(pacificInputValueToUtcIso('2026-07-27T14:16')).toBe('2026-07-27T21:16:00.000Z');
  });
});

describe('utcToPacificInputValue', () => {
  it('converts a UTC instant back to Pacific wall-clock for seeding an input', () => {
    expect(utcToPacificInputValue('2026-07-28T05:00:00.000Z')).toBe('2026-07-27T22:00');
  });

  it('round-trips through pacificInputValueToUtcIso without drift', () => {
    const original = '2026-07-27T22:00';
    const utc = pacificInputValueToUtcIso(original);
    expect(utcToPacificInputValue(utc)).toBe(original);
  });
});

describe('formatPacific', () => {
  it('always renders in Pacific time regardless of the value, with a PT suffix', () => {
    const formatted = formatPacific('2026-07-28T05:00:00.000Z', { hour: 'numeric', minute: '2-digit' });
    expect(formatted).toContain('10:00');
    expect(formatted).toContain('PM');
    expect(formatted.endsWith('PT')).toBe(true);
  });
});
