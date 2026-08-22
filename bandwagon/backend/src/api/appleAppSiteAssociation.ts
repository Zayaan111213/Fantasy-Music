/**
 * The apple-app-site-association document, kept out of server.ts so it can be
 * asserted on directly. Importing server.ts to test it would boot sockets, the
 * pipeline scheduler and the email dispatcher.
 *
 * The Team ID is not a secret — this file is public by design and the same
 * value ships inside every copy of the app. It must match `bundleIdentifier`
 * in mobile/app.json.
 */
export const APPLE_APP_ID = '64YY39ABUD.com.bandwagoner.app';

/**
 * `components` is the load-bearing part. `applinks:bandwagoner.com` in
 * app.json claims the WHOLE domain by default, so without narrowing here,
 * tapping any bandwagoner.com link on a phone with the app installed would
 * open the app — including the Privacy Policy and Terms links that Account
 * Settings deliberately opens in a browser.
 *
 * Both claimed paths have a handler on the app side:
 *   /reset-password    resolves through React Navigation's linking config
 *   /leagues/join/*    is intercepted and stashed by lib/pendingInvite.ts,
 *                      then opened once the full app stack is mounted, so an
 *                      invite tapped while logged out survives signup
 */
export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    details: [
      {
        appIDs: [APPLE_APP_ID],
        components: [
          { '/': '/reset-password', comment: 'password reset link from email' },
          { '/': '/leagues/join/*', comment: 'league invite link' },
        ],
      },
    ],
  },
} as const;
