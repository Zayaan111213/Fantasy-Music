import { test, expect, request } from '@playwright/test';
import { createUser, loginAs, type TestUser } from '../helpers/auth';
import { apiGet, apiPost, setupActiveLeague, teardownLeague, type ActiveLeagueFixture } from '../helpers/api';

const BASE_URL = 'http://localhost:3001';

function uniqueEmail() {
  return `e2e-delete-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.internal`;
}

test.describe('Account deletion', () => {
  let user: TestUser;
  const PASSWORD = 'deleteme123!';

  test.beforeAll(async () => {
    user = await createUser(
      uniqueEmail(),
      PASSWORD,
      `del${Date.now()}${Math.random().toString(36).slice(2, 5)}`.slice(0, 20),
    );
  });

  test.afterAll(async () => {
    // No-op for the happy path (the account is hard-deleted by the test);
    // keeps the DB clean if the test failed midway.
    const ctx = await request.newContext({ baseURL: BASE_URL });
    await ctx.delete('/api/test/cleanup', { data: { userIds: [user.id] } });
    await ctx.dispose();
  });

  test('danger zone: wrong password rejected, then delete logs out and kills the login', async ({ page }) => {
    await loginAs(page, user.email, PASSWORD);

    await page.goto('/account');
    await page.getByRole('button', { name: 'Delete Account' }).click();

    // Confirm step lists the consequences and requires the password.
    await expect(page.getByText('This cannot be undone.')).toBeVisible();

    await page.getByLabel('Confirm your password').fill('not-the-password1!');
    await page.getByRole('button', { name: 'Permanently delete' }).click();
    await expect(page.getByText('Incorrect password')).toBeVisible({ timeout: 5_000 });

    await page.getByLabel('Confirm your password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Permanently delete' }).click();

    // Logged out and bounced to the auth page.
    await page.waitForURL('**/auth', { timeout: 10_000 });
    expect(await page.evaluate(() => localStorage.getItem('bw_token'))).toBeNull();

    // The credentials are dead.
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.locator('form').getByRole('button', { name: 'Log In' }).click();
    await expect(page.getByText('Invalid email or password')).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Account deletion in an active league', () => {
  let f: ActiveLeagueFixture;

  test.beforeAll(async () => {
    f = await setupActiveLeague();
  });

  test.afterAll(async () => {
    await teardownLeague(f.leagueId, [f.user1.id, f.user2.id, f.user3.id, f.user4.id]);
  });

  test('commissioner deletion hands off the league, abandons the team, and kills the token', async () => {
    // The commissioner (user1) deletes their account.
    const ctx = await request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${f.user1.token}` },
    });
    const res = await ctx.delete('/api/auth/me', { data: { password: 'testpass123!' } });
    expect(res.ok()).toBeTruthy();

    // Their still-valid JWT is now rejected.
    const me = await ctx.get('/api/auth/me');
    expect(me.status()).toBe(401);
    await ctx.dispose();

    // The league survived and was handed to another member.
    type LeagueView = {
      commissionerId: string;
      teams: { id: string; userId: string; user: { username: string | null } }[];
    };
    const league = await apiGet<LeagueView>(f.user2.token, `/api/leagues/${f.leagueId}`);
    expect(league.commissionerId).not.toBe(f.user1.id);
    expect([f.user2.id, f.user3.id, f.user4.id]).toContain(league.commissionerId);

    // The abandoned team is still in the league, with an anonymized owner.
    const team1 = league.teams.find((t) => t.id === f.team1Id);
    expect(team1).toBeTruthy();
    expect(team1!.user.username).toMatch(/^deleted_/);

    // The feed announced both the handoff and the unmanaged team.
    const activity = await apiGet<{ items: { type: string }[] }>(f.user2.token, `/api/leagues/${f.leagueId}/activity`);
    const types = activity.items.map((i) => i.type);
    expect(types).toContain('commissioner_transferred');
    expect(types).toContain('member_left');

    // The inherited commissionership is fully functional: transfer it onward.
    const heir = [f.user2, f.user3, f.user4].find((u) => u.id === league.commissionerId)!;
    const nextTarget = [f.user2, f.user3, f.user4].find((u) => u.id !== heir.id)!;
    await apiPost(heir.token, `/api/leagues/${f.leagueId}/transfer-commissioner`, { newCommissionerId: nextTarget.id });
    const after = await apiGet<LeagueView>(nextTarget.token, `/api/leagues/${f.leagueId}`);
    expect(after.commissionerId).toBe(nextTarget.id);
  });
});
