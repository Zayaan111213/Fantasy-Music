import { type APIRequestContext, type BrowserContext, type Page, request } from '@playwright/test';

const BASE_URL = 'http://localhost:3001';

export interface TestUser {
  email: string;
  password: string;
  username: string;
  token: string;
  id: string;
}

export async function createUser(email: string, password: string, username: string): Promise<TestUser> {
  const ctx = await request.newContext({ baseURL: BASE_URL });

  const signupRes = await ctx.post('/api/auth/signup', { data: { email, password } });
  if (!signupRes.ok()) {
    const body = await signupRes.text();
    throw new Error(`Signup failed: ${signupRes.status()} ${body}`);
  }
  const { token, user } = await signupRes.json();

  const onboardRes = await ctx.post('/api/auth/complete-onboarding', {
    multipart: { username },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!onboardRes.ok()) {
    const body = await onboardRes.text();
    throw new Error(`Onboarding failed: ${onboardRes.status()} ${body}`);
  }

  await ctx.dispose();
  return { email, password, username, token, id: user.id };
}

export async function loginAs(page: Page, email: string, password: string): Promise<string> {
  await page.goto('/auth');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.locator('form').getByRole('button', { name: 'Log In' }).click();
  await page.waitForURL(/\/(home|onboarding)/, { timeout: 10_000 });
  const token = await page.evaluate(() => localStorage.getItem('bw_token') ?? '');
  return token;
}

export async function injectAuth(context: BrowserContext, token: string): Promise<void> {
  await context.addInitScript((t) => {
    localStorage.setItem('bw_token', t);
  }, token);
}

export async function apiRequest(token: string): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}
