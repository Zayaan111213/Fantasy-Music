import { test, expect } from '@playwright/test';
import { createUser } from '../helpers/auth';

function uniqueEmail() {
  return `e2e-auth-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.internal`;
}

test.describe('Authentication', () => {
  test('signup flow — new user reaches onboarding then home', async ({ page }) => {
    const email = uniqueEmail();
    const password = 'testpass123!';

    await page.goto('/auth');
    await page.getByRole('button', { name: 'Sign Up' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create Account' }).click();

    await page.waitForURL('**/onboarding', { timeout: 10_000 });
    await expect(page.getByText('Set up your profile')).toBeVisible();

    // Random suffix: the fast and full projects run this spec concurrently, so
    // a timestamp alone can collide on the unique username constraint.
    const username = `t${Date.now()}${Math.random().toString(36).slice(2, 5)}`.slice(0, 20);
    await page.getByLabel('Username').fill(username);
    await expect(page.locator('svg.text-green-400, .text-green-400').first()).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.waitForURL('**/home', { timeout: 10_000 });

    // New accounts get the how-it-works modal on their first Home visit
    await expect(page.getByText('How Bandwagoner Works')).toBeVisible();
    await page.getByRole('button', { name: /Got it/ }).click();
    await expect(page.getByText('How Bandwagoner Works')).not.toBeVisible();

    await expect(page.getByText('Bandwagoner')).toBeVisible();
  });

  test('demo account buttons fill the login form', async ({ page }) => {
    await page.goto('/auth');
    await page.getByRole('button', { name: 'HookHunter' }).click();
    await expect(page.getByLabel('Email')).toHaveValue('demo4@bandwagon.app');
    await expect(page.getByLabel('Password')).toHaveValue('password123');
    await page.getByRole('button', { name: 'MusicMaven' }).click();
    await expect(page.getByLabel('Email')).toHaveValue('demo1@bandwagon.app');
  });

  test('login flow — existing user lands on home', async ({ page }) => {
    const email = uniqueEmail();
    const user = await createUser(email, 'testpass123!', `lt${Date.now()}${Math.random().toString(36).slice(2, 5)}`.slice(0, 20));

    await page.goto('/auth');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill('testpass123!');
    await page.locator('form').getByRole('button', { name: 'Log In' }).click();

    await page.waitForURL('**/home', { timeout: 10_000 });
    await expect(page.getByText('Bandwagoner')).toBeVisible();
  });

  test('wrong password — shows error banner', async ({ page }) => {
    const email = uniqueEmail();
    await createUser(email, 'rightpass123!', `et${Date.now()}${Math.random().toString(36).slice(2, 5)}`.slice(0, 20));

    await page.goto('/auth');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('wrongpassword');
    await page.locator('form').getByRole('button', { name: 'Log In' }).click();

    await expect(page.getByText('Invalid email or password')).toBeVisible({ timeout: 5_000 });
    expect(page.url()).toContain('/auth');
  });
});
