import { describe, it, expect, beforeEach } from 'vitest';
import { getConsentStatus, setConsentStatus } from '../../lib/posthog';

beforeEach(() => {
  localStorage.clear();
});

describe('cookie consent status', () => {
  it('returns null when no decision has been recorded', () => {
    expect(getConsentStatus()).toBeNull();
  });

  it('round-trips an accepted decision through localStorage', () => {
    setConsentStatus('accepted');
    expect(getConsentStatus()).toBe('accepted');
  });

  it('round-trips a declined decision through localStorage', () => {
    setConsentStatus('declined');
    expect(getConsentStatus()).toBe('declined');
  });

  it('ignores unrelated/garbage localStorage values', () => {
    localStorage.setItem('bw_cookie_consent', 'garbage');
    expect(getConsentStatus()).toBeNull();
  });
});
