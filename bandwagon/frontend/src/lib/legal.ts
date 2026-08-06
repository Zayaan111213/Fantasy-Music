/**
 * Single source of truth for the values that appear in the public legal pages
 * (/privacy and /terms) so the two documents can never drift apart.
 *
 * TODO(before submitting to the App Store): confirm both of these.
 *
 *  - CONTACT_EMAIL must actually receive mail. The domain is registered through
 *    Porkbun, and notifications@bandwagoner.com is send-only (Resend), so this
 *    address needs an email forward set up or a reviewer (and any user
 *    exercising a privacy right) will hit a bounce.
 *  - GOVERNING_LAW_STATE must be the state you actually reside in. It is not
 *    something to leave at a default.
 */
export const CONTACT_EMAIL = 'support@bandwagoner.com';

export const GOVERNING_LAW_STATE = 'California';

export const LEGAL_EFFECTIVE_DATE = 'August 5, 2026';
