import { test, expect } from '@playwright/test';
import { injectAuth } from '../helpers/auth';
import { setupActiveLeague, teardownLeague, type ActiveLeagueFixture } from '../helpers/api';

test.describe('Matchup and standings views', () => {
  let fixture: ActiveLeagueFixture;

  test.beforeAll(async () => {
    fixture = await setupActiveLeague();
  });

  test.afterAll(async () => {
    await teardownLeague(fixture.leagueId, [fixture.user1.id, fixture.user2.id]);
  });

  test('matchup tab shows both team names and scores', async ({ browser: b }) => {
    const ctx = await b.newContext();
    await injectAuth(ctx, fixture.user1.token);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fixture.leagueId}`);
    await page.getByRole('button', { name: 'Matchup' }).click();

    // Both team names should appear in the matchup H2H header
    await expect(page.getByText('E2E Team A').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E Team B').first()).toBeVisible({ timeout: 10_000 });

    // At least one score should be visible (42.5 or 38.0 from fixture)
    await expect(page.getByText('42.5').or(page.getByText('38.0')).first()).toBeVisible({ timeout: 5_000 });

    await ctx.close();
  });

  test('standings tab shows ranked rows for both teams', async ({ browser: b }) => {
    const ctx = await b.newContext();
    await injectAuth(ctx, fixture.user1.token);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fixture.leagueId}`);
    await page.getByRole('button', { name: 'Standings' }).click();

    // Both teams should appear
    await expect(page.getByText('E2E Team A')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E Team B')).toBeVisible({ timeout: 10_000 });

    // Rank numbers 1 and 2 should be present in the table
    await expect(page.getByText('1').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('2').first()).toBeVisible({ timeout: 5_000 });

    await ctx.close();
  });
});
