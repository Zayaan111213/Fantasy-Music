/**
 * Single source of truth for the values that appear in the public legal pages
 * (/privacy and /terms) so the two documents can never drift apart.
 *
 * GOVERNING_LAW_STATE is confirmed correct (2026-08-21) — it is the state of
 * residence, not a leftover default.
 *
 * CONTACT_EMAIL is load-bearing in three places at once: the privacy contact
 * printed on both legal pages, the App Store support contact, and the
 * destination for in-app content reports (SUPPORT_EMAIL in the backend's
 * moderation routes defaults to it). bandwagoner.com publishes MX records for
 * Porkbun's forwarders, so the domain accepts mail; what still has to hold is
 * a forward rule for this specific alias. notifications@bandwagoner.com is
 * send-only via Resend and cannot receive, so it is not a substitute.
 */
export const CONTACT_EMAIL = 'support@bandwagoner.com';

export const GOVERNING_LAW_STATE = 'California';

export const LEGAL_EFFECTIVE_DATE = 'August 5, 2026';
