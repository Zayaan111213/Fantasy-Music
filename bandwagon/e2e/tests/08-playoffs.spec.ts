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

// 8-team league still in the regular season (week 10 not finalized): the
// Standings tab shows the full projected bracket — semifinals 1v4/2v3 plus
// the 5v8/6v7 consolation bracket.
test.describe('Projected bracket (8 teams)', () => {
  let fx: PlayoffsFixture;

  test.beforeAll(async () => {
    fx = await apiPost<PlayoffsFixture>('', '/api/test/advance-to-playoffs', { teamCount: 8 });
  });

  test.afterAll(async () => {
    await teardownLeague(fx.leagueId, fx.userIds);
  });

  test('standings shows projected semifinals and consolation bracket', async ({ browser }) => {
    const ctx = await browser.newContext();
    await injectAuth(ctx, fx.tokens[0]);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fx.leagueId}`);
    await page.getByRole('button', { name: 'Standings' }).click();

    await expect(page.getByText('Playoff Bracket')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Projected')).toBeVisible();
    await expect(page.getByText('If the season ended today')).toBeVisible();
    await expect(page.getByText('Consolation Bracket')).toBeVisible();

    // Every seed appears in the bracket card (once in standings, once in bracket)
    for (let seed = 1; seed <= 8; seed++) {
      await expect(page.getByText(`Seed ${seed} Team`)).toHaveCount(2);
    }
    // Finals boxes are TBD until the semifinals are played
    await expect(page.getByText('🏆 Championship')).toBeVisible();
    await expect(page.getByText('🥉 3rd Place Game')).toBeVisible();
    await expect(page.getByText('Consolation winners')).toBeVisible();
    await expect(page.getByText('Consolation losers')).toBeVisible();

    await page.screenshot({ path: test.info().outputPath('projected-bracket-8team.png'), fullPage: true });
    await ctx.close();
  });
});

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
    await expect(page.getByText('Semifinal', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Seed 1 Team').first()).toBeVisible();
    await expect(page.getByText('Seed 4 Team').first()).toBeVisible();

    // Around the League lists the whole week-11 slate, including the
    // consolation games this user isn't in
    await expect(page.getByText('Around the League')).toBeVisible();
    await expect(page.getByText('Seed 5 Team')).toBeVisible();
    await expect(page.getByText('Seed 8 Team')).toBeVisible();

    await page.screenshot({ path: test.info().outputPath('week11-semifinal.png'), fullPage: true });
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

    // Real (non-projected) bracket: week-11 games exist, week-12 games are TBD,
    // and the 9-team league has a full consolation bracket.
    await expect(page.getByText('Playoff Bracket')).toBeVisible();
    await expect(page.getByText('Projected')).not.toBeVisible();
    await expect(page.getByText('Semifinal winners')).toBeVisible();
    await expect(page.getByText('Consolation Bracket')).toBeVisible();
    await expect(page.getByText('Consolation winners')).toBeVisible();

    await page.screenshot({ path: test.info().outputPath('live-bracket.png'), fullPage: true });
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
    await expect(page.getByText('🏆 Championship').first()).toBeVisible();
    await expect(page.getByText('Seed 2 Team').first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('week12-championship.png') });

    // Seed 3 (semifinal loser) plays the 3rd place game.
    const ctx3 = await browser.newContext();
    await injectAuth(ctx3, fx.tokens[2]);
    const page3 = await ctx3.newPage();
    await page3.goto(`/leagues/${fx.leagueId}`);
    await page3.getByRole('button', { name: 'Matchup' }).click();
    await expect(page3.getByText('🥉 3rd Place Game').first()).toBeVisible({ timeout: 10_000 });
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
