import { test, expect, request } from '@playwright/test';
import { createUser, type TestUser } from '../helpers/auth';

const BASE_URL = 'http://localhost:3001';

function uniqueEmail() {
  return `e2e-reset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.internal`;
}

async function mintResetToken(email: string): Promise<string> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const res = await ctx.post('/api/test/reset-token', { data: { email } });
  const body = await res.json();
  await ctx.dispose();
  if (!res.ok()) throw new Error(`reset-token helper failed: ${res.status()} ${JSON.stringify(body)}`);
  return body.token as string;
}

test.describe('Password reset', () => {
  let user: TestUser;
  const OLD_PASSWORD = 'origpass123!';
  const NEW_PASSWORD = 'newpass456!';

  test.beforeAll(async () => {
    user = await createUser(
      uniqueEmail(),
      OLD_PASSWORD,
      `pr${Date.now()}${Math.random().toString(36).slice(2, 5)}`.slice(0, 20),
    );
  });

  test.afterAll(async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    await ctx.delete('/api/test/cleanup', { data: { userIds: [user.id] } });
    await ctx.dispose();
  });

  test('full flow: forgot form, reset link, new password works, link is single-use', async ({ page }) => {
    // Login page → Forgot password link (login mode only).
    await page.goto('/auth');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await page.waitForURL('**/forgot-password');

    // Unknown email → explicit error (product decision: reveals account existence).
    await page.getByLabel('Email').fill('nobody@test.internal');
    await page.getByRole('button', { name: 'Send Reset Link' }).click();
    await expect(page.getByText('No account found with that email')).toBeVisible({ timeout: 5_000 });

    // Real email → success panel (send is 'skipped' without RESEND_API_KEY, still 200).
    await page.getByLabel('Email').fill(user.email);
    await page.getByRole('button', { name: 'Send Reset Link' }).click();
    await expect(page.getByText('Check your inbox')).toBeVisible({ timeout: 5_000 });

    // The emailed token is unavailable in e2e (only its hash is stored), so mint
    // one through the test-only helper, which uses the same production path.
    const token = await mintResetToken(user.email);

    // Reset page: mismatch guard, then the real reset → auto-login to /home.
    await page.goto(`/reset-password?token=${token}`);
    await page.getByLabel('New Password').fill(NEW_PASSWORD);
    await page.getByLabel('Confirm Password').fill('different1');
    await page.getByRole('button', { name: 'Set New Password' }).click();
    await expect(page.getByText('Passwords do not match')).toBeVisible();

    await page.getByLabel('Confirm Password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Set New Password' }).click();
    await page.waitForURL('**/home', { timeout: 10_000 });

    // Old password no longer works.
    await page.evaluate(() => localStorage.removeItem('bw_token'));
    await page.goto('/auth');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(OLD_PASSWORD);
    await page.locator('form').getByRole('button', { name: 'Log In' }).click();
    await expect(page.getByText('Invalid email or password')).toBeVisible({ timeout: 5_000 });

    // New password logs in.
    await page.getByLabel('Password').fill(NEW_PASSWORD);
    await page.locator('form').getByRole('button', { name: 'Log In' }).click();
    await page.waitForURL('**/home', { timeout: 10_000 });

    // The link is single-use: reusing the same token fails.
    await page.evaluate(() => localStorage.removeItem('bw_token'));
    await page.goto(`/reset-password?token=${token}`);
    await page.getByLabel('New Password').fill('anotherpass789!');
    await page.getByLabel('Confirm Password').fill('anotherpass789!');
    await page.getByRole('button', { name: 'Set New Password' }).click();
    await expect(page.getByText('Invalid or expired reset link')).toBeVisible({ timeout: 5_000 });
  });

  test('reset page without a token shows the invalid-link state', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page.getByText('This reset link is invalid.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();
  });
});
