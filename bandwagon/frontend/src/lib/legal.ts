/**
 * Single source of truth for the values that appear in the public legal pages
 * (/privacy and /terms) so the two documents can never drift apart.
 *
 * GOVERNING_LAW_STATE is confirmed correct (2026-08-21) — it is the state of
 * residence, not a leftover default.
 *
 * CONTACT_EMAIL is load-bearing in three places at once: the privacy contact
 * printed on both legal pages, the App Store support contact, and the
 * destination for in-app content reports. App Review guideline 1.2 requires
 * published contact information that actually reaches you, so this address has
 * to be a live inbox — a reviewer may well test it.
 *
 * It is deliberately NOT on bandwagoner.com. Porkbun charges for forwarding on
 * this domain, and notifications@bandwagoner.com is send-only through Resend,
 * so nothing at the domain can currently receive. Apple does not require the
 * support address to match the app's domain; it only has to work.
 *
 * Two other copies of this address exist and cannot import this file — the
 * backend has no dependency on the web app, and mobile has no shared package
 * (see CLAUDE.md). Change all three together:
 *   backend/src/api/routes/moderation.ts   SUPPORT_EMAIL fallback
 *   mobile/src/screens/AccountSettingsScreen.tsx   SUPPORT_EMAIL
 */
export const CONTACT_EMAIL = 'bandwagonersupport@gmail.com';

export const GOVERNING_LAW_STATE = 'California';

export const LEGAL_EFFECTIVE_DATE = 'August 21, 2026';
