import { test, expect } from '@playwright/test';
import { injectAuth } from '../helpers/auth';
import { apiGet, apiPost, teardownLeague } from '../helpers/api';

interface PlayoffsFixture {
  leagueId: string;
  token: string;
  tokens: string[];
  userIds: string[];
  teams: { id: string; name: string; seed: number }[];
}

// Local-time value for a datetime-local input, tomorrow at noon.
function tomorrowNoonLocal(): string {
  const t = new Date(Date.now() + 24 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T12:00`;
}

test.describe('Season rollover', () => {
  let fx: PlayoffsFixture;

  test.beforeAll(async () => {
    // 4-team league at end of regular season; finalize 10 → 11 → 12 crowns
    // Seed 1 (dead ties go to the higher seed) and completes the season.
    fx = await apiPost<PlayoffsFixture>('', '/api/test/advance-to-playoffs', { teamCount: 4 });
    for (const week of [10, 11, 12]) {
      await apiPost('', '/api/test/finalize-week', { leagueId: fx.leagueId, week });
    }
  });

  test.afterAll(async () => {
    await teardownLeague(fx.leagueId, fx.userIds);
  });

  test('non-commissioner sees the champion but no renew button', async ({ browser }) => {
    const ctx = await browser.newContext();
    await injectAuth(ctx, fx.tokens[1]);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fx.leagueId}`);
    await expect(page.getByText('Seed 1 Team are the 2026 champions!')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Ask your commissioner to renew the league')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Renew League' })).not.toBeVisible();
    await ctx.close();
  });

  test('commissioner renews the league: new draft time, fresh pending season', async ({ browser }) => {
    const ctx = await browser.newContext();
    await injectAuth(ctx, fx.tokens[0]); // users[0] is the commissioner
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fx.leagueId}`);
    await expect(page.getByText('Seed 1 Team are the 2026 champions!')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Renew League' }).click();
    await page.locator('input[type="datetime-local"]').fill(tomorrowNoonLocal());

    const [renewResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/renew') && res.request().method() === 'POST', { timeout: 15_000 }),
      page.getByRole('button', { name: 'Start New Season' }).click(),
    ]);
    expect(renewResponse.status()).toBe(200);
    expect(await renewResponse.json()).toMatchObject({ ok: true, seasonYear: 2027 });

    // The champion banner disappears once the league is pending again
    await expect(page.getByText('Seed 1 Team are the 2026 champions!')).not.toBeVisible({ timeout: 10_000 });

    // League state: pending, next season, future draft time
    const league = await apiGet<{
      status: string; seasonYear: number; currentWeek: number; draftTime: string;
      teams: { id: string; name: string; wins: number; draftPosition: number }[];
    }>(fx.tokens[0], `/api/leagues/${fx.leagueId}`);
    expect(league.status).toBe('pending');
    expect(league.seasonYear).toBe(2027);
    expect(league.currentWeek).toBe(1);
    expect(new Date(league.draftTime).getTime()).toBeGreaterThan(Date.now());

    // Records reset; draft order is reverse final standings — the champion
    // (Seed 1 Team) picks last, the worst team (Seed 4 Team) picks first.
    const byName = new Map(league.teams.map((t) => [t.name, t]));
    expect(league.teams.every((t) => t.wins === 0)).toBe(true);
    expect(byName.get('Seed 4 Team')!.draftPosition).toBe(1);
    expect(byName.get('Seed 1 Team')!.draftPosition).toBe(4);

    // Rosters are empty again
    const rosters = await apiGet<{ rosterSpots: { artist: unknown | null }[] }[]>(
      fx.tokens[0], `/api/leagues/${fx.leagueId}/teams-with-rosters`,
    );
    expect(rosters.every((t) => t.rosterSpots.every((s) => !s.artist))).toBe(true);

    // Renewal is announced in the feed
    await page.getByRole('button', { name: /Notifications/ }).click();
    await expect(page.getByText(/renewed for 2027/).first()).toBeVisible({ timeout: 10_000 });

    await ctx.close();
  });
});
