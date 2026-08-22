import { describe, it, expect } from 'vitest';

import { APPLE_APP_ID, APPLE_APP_SITE_ASSOCIATION } from '../../api/appleAppSiteAssociation';

// Universal links fail silently: a wrong document means Apple's CDN rejects the
// file, links quietly open in Safari forever, and there is nothing in the app
// to debug. These assertions are the things that break it.
describe('apple-app-site-association', () => {
  const detail = APPLE_APP_SITE_ASSOCIATION.applinks.details[0];
  const paths: string[] = detail.components.map((c) => c['/']);

  it('pairs the Apple Team ID with the bundle identifier from mobile/app.json', () => {
    expect(detail.appIDs).toEqual([APPLE_APP_ID]);
    expect(APPLE_APP_ID).toBe('64YY39ABUD.com.bandwagoner.app');
  });

  it('claims the password reset and league invite paths', () => {
    expect(paths).toEqual(['/reset-password', '/leagues/join/*']);
  });

  it('leaves the legal pages to the browser', () => {
    // app.json claims the whole domain; only this narrowing keeps the Privacy
    // Policy and Terms links — which Account Settings opens externally on
    // purpose — out of the app.
    expect(paths).not.toContain('*');
    expect(paths).not.toContain('/');
    expect(paths.some((p) => p.startsWith('/privacy') || p.startsWith('/terms'))).toBe(false);
  });

  it('claims only paths the app can actually handle', () => {
    // /reset-password resolves through React Navigation's linking config;
    // /leagues/join/* is intercepted by lib/pendingInvite.ts. Anything added
    // here without a handler opens the app to a dead end, which is worse than
    // letting Safari have the link.
    const handled = ['/reset-password', '/leagues/join/*'];
    for (const p of paths) expect(handled).toContain(p);
  });
});
