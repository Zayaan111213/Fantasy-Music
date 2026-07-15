import { test, expect } from '@playwright/test';
import { createUser, injectAuth } from '../helpers/auth';

function uniqueEmail(role: string) {
  return `e2e-league-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}@test.internal`;
}

test.describe('League management', () => {
  let commissioner: { token: string; username: string };
  let member: { token: string; username: string };
  let inviteCode: string;
  let leagueId: string;

  test.beforeAll(async () => {
    // Random suffix: the fast and full projects run concurrently, so a
    // timestamp alone can collide on the unique username constraint.
    const ts = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
    const u1 = await createUser(uniqueEmail('comm'), 'testpass123', `comm${ts}`.slice(0, 20));
    const u2 = await createUser(uniqueEmail('mem'), 'testpass123', `mem${ts}`.slice(0, 20));
    commissioner = { token: u1.token, username: u1.username };
    member = { token: u2.token, username: u2.username };
  });

  test('commissioner creates a private league', async ({ browser: b }) => {
    const ctx = await b.newContext();
    await injectAuth(ctx, commissioner.token);
    const page = await ctx.newPage();

    await page.goto('/leagues/create');
    await page.getByLabel('League Name').fill('E2E Test League');

    // Set draft time to 2 hours from now using the datetime-local input
    const draftTime = new Date(Date.now() + 2 * 60 * 60_000);
    const local = draftTime.toISOString().slice(0, 16);
    await page.locator('input[type="datetime-local"]').fill(local);

    await page.getByRole('button', { name: 'Create League & Get Invite Link' }).click();

    await expect(page.getByText('League Created!')).toBeVisible({ timeout: 10_000 });

    // Extract invite code from the URL shown on screen
    const inviteUrlText = await page.locator('.truncate').textContent();
    const match = inviteUrlText?.match(/\/leagues\/join\/([A-Z0-9]+)/);
    expect(match).not.toBeNull();
    inviteCode = match![1];

    // Click "Go to League" and capture the league ID from the URL
    await page.getByRole('button', { name: 'Go to League' }).click();
    await page.waitForURL('**/leagues/**', { timeout: 10_000 });
    leagueId = page.url().match(/\/leagues\/([^/]+)/)?.[1] ?? '';
    expect(leagueId).toBeTruthy();

    await ctx.close();
  });

  test('member joins via invite code', async ({ browser: b }) => {
    expect(inviteCode).toBeTruthy();

    const ctx = await b.newContext();
    await injectAuth(ctx, member.token);
    const page = await ctx.newPage();

    await page.goto(`/leagues/join/${inviteCode}`);
    // Wait for the join button or redirect to league
    await page.getByRole('button', { name: 'Join League' }).click();
    await page.waitForURL('**/leagues/**', { timeout: 10_000 });

    await expect(page.getByText('E2E Test League')).toBeVisible({ timeout: 5_000 });

    await ctx.close();
  });

  test('invite code visible in Settings tab', async ({ browser: b }) => {
    expect(leagueId).toBeTruthy();

    const ctx = await b.newContext();
    await injectAuth(ctx, commissioner.token);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${leagueId}`);
    await page.getByRole('button', { name: 'Settings' }).click();

    await expect(page.getByText(inviteCode, { exact: true })).toBeVisible({ timeout: 5_000 });

    await ctx.close();
  });
});
