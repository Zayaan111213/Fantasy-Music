import { request } from '@playwright/test';

const BASE_URL = 'http://localhost:3001';

async function ctx(token?: string) {
  return request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function apiGet<T>(token: string, path: string): Promise<T> {
  const c = await ctx(token);
  const res = await c.get(path);
  const body = await res.json();
  await c.dispose();
  if (!res.ok()) throw new Error(`GET ${path} failed: ${res.status()} ${JSON.stringify(body)}`);
  return body as T;
}

export async function apiPost<T>(token: string, path: string, data?: object): Promise<T> {
  const c = await ctx(token);
  const res = await c.post(path, { data });
  const body = await res.json();
  await c.dispose();
  if (!res.ok()) throw new Error(`POST ${path} failed: ${res.status()} ${JSON.stringify(body)}`);
  return body as T;
}

export async function apiPut<T>(token: string, path: string, data?: object): Promise<{ status: number; body: T }> {
  const c = await ctx(token);
  const res = await c.put(path, { data });
  const body = await res.json();
  await c.dispose();
  return { status: res.status(), body: body as T };
}

export interface ActiveLeagueFixture {
  user1: { id: string; email: string; token: string };
  user2: { id: string; email: string; token: string };
  user3: { id: string; email: string; token: string };
  user4: { id: string; email: string; token: string };
  leagueId: string;
  team1Id: string;
  team2Id: string;
  team3Id: string;
  team4Id: string;
}

export async function setupActiveLeague(opts?: { draftDaysAgo?: number }): Promise<ActiveLeagueFixture> {
  const c = await ctx();
  const res = await c.post('/api/test/active-league', { data: opts ?? {} });
  const body = await res.json();
  await c.dispose();
  if (!res.ok()) throw new Error(`Test setup failed: ${res.status()} ${JSON.stringify(body)}`);
  return body as ActiveLeagueFixture;
}

export async function teardownLeague(leagueId: string, userIds: string[]): Promise<void> {
  const c = await ctx();
  await c.delete('/api/test/cleanup', { data: { leagueId, userIds } });
  await c.dispose();
}
