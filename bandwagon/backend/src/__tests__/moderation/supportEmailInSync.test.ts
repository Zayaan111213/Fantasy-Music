import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * The published support address exists in three copies that cannot import one
 * another: the backend has no dependency on the web app, and mobile has no
 * shared package (see CLAUDE.md). A comment asking the next person to "change
 * all three" is not enforcement, and the failure is silent and serious — App
 * Review guideline 1.2 requires published contact information that actually
 * reaches you, so a stale copy publishes a dead address on a legal page or in
 * the app's About card.
 *
 * Reading the files rather than importing them keeps this test free of any
 * cross-package build dependency; the whole monorepo is checked out in CI.
 */
const REPO = path.resolve(__dirname, '../../../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

function extract(rel: string, pattern: RegExp): string {
  const match = pattern.exec(read(rel));
  if (!match) throw new Error(`No support address found in ${rel} — did the declaration change shape?`);
  return match[1];
}

describe('published support address', () => {
  const canonical = extract(
    'frontend/src/lib/legal.ts',
    /export const CONTACT_EMAIL = '([^']+)'/,
  );

  it('is a plausible address', () => {
    expect(canonical).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);
  });

  it('matches the fallback the backend emails content reports to', () => {
    const backend = extract(
      'backend/src/api/routes/moderation.ts',
      /const SUPPORT_EMAIL = process\.env\.SUPPORT_EMAIL \|\| '([^']+)'/,
    );
    expect(backend).toBe(canonical);
  });

  it("matches the address in the mobile app's About card", () => {
    const mobile = extract(
      'mobile/src/screens/AccountSettingsScreen.tsx',
      /const SUPPORT_EMAIL = '([^']+)'/,
    );
    expect(mobile).toBe(canonical);
  });

  it('is not an address on bandwagoner.com, which cannot receive mail', () => {
    // Porkbun charges for forwarding on this domain and
    // notifications@bandwagoner.com is send-only through Resend, so nothing at
    // the domain has an inbox. If that changes, delete this test rather than
    // working around it.
    expect(canonical.endsWith('@bandwagoner.com')).toBe(false);
  });
});
