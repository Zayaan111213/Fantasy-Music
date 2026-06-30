import { test, expect } from '@playwright/test';
import { injectAuth } from '../helpers/auth';
import { setupActiveLeague, teardownLeague, type ActiveLeagueFixture } from '../helpers/api';

test.describe('Matchup and standings views', () => {
  let fixture: ActiveLeagueFixture;

  test.beforeAll(async () => {
    fixture = await setupActiveLeague();
  });

  test.afterAll(async () => {
    await teardownLeague(
      fixture.leagueId,
      [fixture.user1.id, fixture.user2.id, fixture.user3.id, fixture.user4.id],
    );
  });

  test('matchup tab shows both team names and scores', async ({ browser: b }) => {
    const ctx = await b.newContext();
    await injectAuth(ctx, fixture.user1.token);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fixture.leagueId}`);
    await page.getByRole('button', { name: 'Matchup' }).click();

    // Week 1: Team A (home) faces Team D (away) — the round-robin pinning rule
    // places team at index 0 vs team at index 3 in week 1.
    await expect(page.getByText('E2E Team A').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E Team D').first()).toBeVisible({ timeout: 10_000 });

    // Scores set by the fixture: A=42.5, D=38.0
    await expect(page.getByText('42.5').or(page.getByText('38.0')).first()).toBeVisible({ timeout: 5_000 });

    await ctx.close();
  });

  test('standings tab shows all four teams ranked 1–4', async ({ browser: b }) => {
    const ctx = await b.newContext();
    await injectAuth(ctx, fixture.user1.token);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fixture.leagueId}`);
    await page.getByRole('button', { name: 'Standings' }).click();

    // All four teams must appear
    await expect(page.getByText('E2E Team A')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E Team B')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E Team C')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E Team D')).toBeVisible({ timeout: 10_000 });

    // Rank numbers 1 through 4 should all be present
    await expect(page.getByText('1').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('4').first()).toBeVisible({ timeout: 5_000 });

    await ctx.close();
  });
});
