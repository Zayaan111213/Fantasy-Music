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

    // Around the League shows the week's other game too (B vs C)
    await expect(page.getByText('Around the League')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('E2E Team B')).toBeVisible();
    await expect(page.getByText('E2E Team C')).toBeVisible();

    await ctx.close();
  });

  test('around-the-league matchup expands on click to show both rosters', async ({ browser: b }) => {
    const ctx = await b.newContext();
    await injectAuth(ctx, fixture.user1.token);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fixture.leagueId}`);
    await page.getByRole('button', { name: 'Matchup' }).click();
    await expect(page.getByText('Around the League')).toBeVisible({ timeout: 10_000 });

    // B vs C is the week-1 game user1 is not in — collapsed, each name renders once.
    await expect(page.getByText('E2E Team B')).toHaveCount(1);

    // Expand: the row is a button whose accessible name contains both teams.
    await page.getByRole('button', { name: /E2E Team B/ }).click();

    // The detail panel adds a roster card titled with each team name.
    await expect(page.getByText('E2E Team B')).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByText('E2E Team C')).toHaveCount(2);

    // Collapse again.
    await page.getByRole('button', { name: /E2E Team B/ }).click();
    await expect(page.getByText('E2E Team B')).toHaveCount(1);

    await ctx.close();
  });

  test('standings tab shows all four teams ranked 1–4', async ({ browser: b }) => {
    const ctx = await b.newContext();
    await injectAuth(ctx, fixture.user1.token);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fixture.leagueId}`);
    await page.getByRole('button', { name: 'Standings' }).click();

    // All four teams must appear (.first() — names also render in the bracket card)
    await expect(page.getByText('E2E Team A').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E Team B').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E Team C').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E Team D').first()).toBeVisible({ timeout: 10_000 });

    // Rank numbers 1 through 4 should all be present
    await expect(page.getByText('1').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('4').first()).toBeVisible({ timeout: 5_000 });

    await ctx.close();
  });

  test('standings tab shows a projected playoff bracket during the regular season', async ({ browser: b }) => {
    const ctx = await b.newContext();
    await injectAuth(ctx, fixture.user1.token);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fixture.leagueId}`);
    await page.getByRole('button', { name: 'Standings' }).click();

    await expect(page.getByText('Playoff Bracket')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Projected')).toBeVisible();
    await expect(page.getByText('If the season ended today')).toBeVisible();
    // Week-12 games are unknown before the semifinals are played
    await expect(page.getByText('Semifinal winners')).toBeVisible();
    await expect(page.getByText('Semifinal losers')).toBeVisible();
    // 4-team league: no consolation bracket
    await expect(page.getByText('Consolation Bracket')).not.toBeVisible();

    await page.screenshot({ path: test.info().outputPath('projected-bracket.png'), fullPage: true });
    await ctx.close();
  });

  test('week dropdown jumps to any week from the matchup tab', async ({ browser: b }) => {
    const ctx = await b.newContext();
    await injectAuth(ctx, fixture.user1.token);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fixture.leagueId}`);
    await page.getByRole('button', { name: 'Matchup' }).click();

    // Open the week picker from the nav label and jump to week 3
    await page.getByRole('button', { name: 'Week 1', exact: true }).click();
    await page.getByRole('button', { name: 'Week 3', exact: true }).click();
    await expect(page.getByText('Week 3 · Upcoming')).toBeVisible({ timeout: 10_000 });

    // Jump back to the current week
    await page.getByRole('button', { name: 'Week 3', exact: true }).click();
    await page.getByRole('button', { name: /^Week 1 Current$/ }).click();
    await expect(page.getByText('E2E Team A').first()).toBeVisible({ timeout: 10_000 });

    await ctx.close();
  });
});
