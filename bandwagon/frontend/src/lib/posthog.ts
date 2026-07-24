import posthog from 'posthog-js';

export function initPostHog(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key || import.meta.env.MODE === 'test') return;

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
