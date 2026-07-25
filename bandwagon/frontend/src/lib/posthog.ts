import posthog from 'posthog-js';

const CONSENT_KEY = 'bw_cookie_consent';

export type ConsentStatus = 'accepted' | 'declined';

// Whether there's actually anything to consent to — no key means PostHog
// never initializes regardless of the user's choice, so there's no point
// asking.
export function isPostHogConfigured(): boolean {
  return Boolean(import.meta.env.VITE_POSTHOG_KEY) && import.meta.env.MODE !== 'test';
}

export function getConsentStatus(): ConsentStatus | null {
  const v = localStorage.getItem(CONSENT_KEY);
  return v === 'accepted' || v === 'declined' ? v : null;
}

export function setConsentStatus(status: ConsentStatus): void {
  localStorage.setItem(CONSENT_KEY, status);
}

export function initPostHog(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key || import.meta.env.MODE === 'test' || getConsentStatus() !== 'accepted') return;

  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: false, // SPA — we fire pageviews manually on route change
    session_recording: { maskAllInputs: true },
  });
}

export function identifyPostHogUser(user: { id: string; email: string; username: string | null }): void {
  posthog.identify(user.id, { email: user.email, username: user.username });
}

export { posthog };
