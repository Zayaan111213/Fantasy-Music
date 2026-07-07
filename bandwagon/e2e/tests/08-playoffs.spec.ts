import { test, expect } from '@playwright/test';
import { injectAuth } from '../helpers/auth';
import { apiPost, teardownLeague } from '../helpers/api';

// 9-team league fixture: seeds 1-4 in the playoff bracket, 5-8 in the
// consolation bracket, seed 9 eliminated after the regular season.
// Playoff scores are never set (0-0 dead ties), so the higher seed always
// advances via the seed tiebreaker — Seed 1 Team wins the championship.
interface PlayoffsFixture {
  leagueId: string;
  token: string;
  tokens: string[];
  userIds: string[];
  teams: { id: string; name: string; seed: number }[];
}

test.describe('Playoffs', () => {
  let fx: PlayoffsFixture;

  test.beforeAll(async () => {
    fx = await apiPost<PlayoffsFixture>('', '/api/test/advance-to-playoffs', { teamCount: 9 });
    // Finalize week 10 → seeds locked, week-11 bracket generated.
    await apiPost('', '/api/test/finalize-week', { leagueId: fx.leagueId, week: 10 });
  });

  test.afterAll(async () => {
    await teardownLeague(fx.leagueId, fx.userIds);
  });

  test('week 11: seed 1 sees the semifinal against seed 4', async ({ browser }) => {
    const ctx = await browser.newContext();
    await injectAuth(ctx, fx.tokens[0]);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fx.leagueId}`);
    await page.getByRole('button', { name: 'Matchup' }).click();

    await expect(page.getByText('Week 11 · Semifinals')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Semifinal', { exact: true })).toBeVisible();
    await expect(page.getByText('Seed 1 Team').first()).toBeVisible();
    await expect(page.getByText('Seed 4 Team').first()).toBeVisible();

    await page.screenshot({ path: test.info().outputPath('week11-semifinal.png') });
    await ctx.close();
  });

  test('week 11: eliminated seed 9 has no playoff game', async ({ browser }) => {
    const ctx = await browser.newContext();
    await injectAuth(ctx, fx.tokens[8]);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fx.leagueId}`);
    await page.getByRole('button', { name: 'Matchup' }).click();

    await expect(page.getByText("You don't have a Week 11 playoff game.")).toBeVisible({ timeout: 10_000 });
    await ctx.close();
  });

  test('standings shows frozen records with playoffs caption', async ({ browser }) => {
    const ctx = await browser.newContext();
    await injectAuth(ctx, fx.tokens[0]);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fx.leagueId}`);
    await page.getByRole('button', { name: 'Standings' }).click();

    await expect(page.getByText('Regular-season record · playoffs in progress')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('── Playoffs ──')).toBeVisible();
    await ctx.close();
  });

  test('week 12: championship tag, then season completes', async ({ browser }) => {
    // Finalize week 11 → dead ties advance higher seeds → championship is 1v2.
    await apiPost('', '/api/test/finalize-week', { leagueId: fx.leagueId, week: 11 });

    const ctx = await browser.newContext();
    await injectAuth(ctx, fx.tokens[0]);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fx.leagueId}`);
    await page.getByRole('button', { name: 'Matchup' }).click();

    await expect(page.getByText('Week 12 · Championship Week')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('🏆 Championship')).toBeVisible();
    await expect(page.getByText('Seed 2 Team').first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('week12-championship.png') });

    // Seed 3 (semifinal loser) plays the 3rd place game.
    const ctx3 = await browser.newContext();
    await injectAuth(ctx3, fx.tokens[2]);
    const page3 = await ctx3.newPage();
    await page3.goto(`/leagues/${fx.leagueId}`);
    await page3.getByRole('button', { name: 'Matchup' }).click();
    await expect(page3.getByText('🥉 3rd Place Game')).toBeVisible({ timeout: 10_000 });
    await page3.screenshot({ path: test.info().outputPath('week12-third-place.png') });
    await ctx3.close();

    // Finalize week 12 → season complete; seed 1 wins the title on the tiebreaker.
    await apiPost('', '/api/test/finalize-week', { leagueId: fx.leagueId, week: 12 });

    await page.goto(`/leagues/${fx.leagueId}`);
    await page.getByRole('button', { name: 'Matchup' }).click();
    await expect(page.getByText('Week 12 · Championship Week')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Win', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('season-complete-final.png') });

    await page.getByRole('button', { name: 'My Team' }).click();
    await expect(page.getByText('Season complete — lineups are final')).toBeVisible();

    await page.getByRole('button', { name: 'Standings' }).click();
    await expect(page.getByText('Final regular-season standings')).toBeVisible();

    await ctx.close();
  });
});
