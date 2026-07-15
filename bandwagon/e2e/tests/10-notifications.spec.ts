import { test, expect } from '@playwright/test';
import { injectAuth } from '../helpers/auth';
import { apiGet, apiPost, setupActiveLeague, teardownLeague, type ActiveLeagueFixture } from '../helpers/api';

interface RosterTeam {
  id: string;
  rosterSpots: { slot: string; artist: { id: string; name: string; primaryGenre: string } | null }[];
}

async function rosterArtists(token: string, leagueId: string, teamId: string) {
  const teams = await apiGet<RosterTeam[]>(token, `/api/leagues/${leagueId}/teams-with-rosters`);
  return teams
    .find((t) => t.id === teamId)!
    .rosterSpots.filter((s) => s.artist)
    .map((s) => s.artist!);
}

test.describe('League notifications tab', () => {
  let fx: ActiveLeagueFixture;

  test.beforeAll(async () => {
    fx = await setupActiveLeague();
  });

  test.afterAll(async () => {
    await teardownLeague(fx.leagueId, [fx.user1.id, fx.user2.id, fx.user3.id, fx.user4.id]);
  });

  test('trade offer shows a badge, a "For you" item, and clears on open', async ({ browser }) => {
    // user1 proposes a 1-for-1 same-genre trade to user2.
    const mine = await rosterArtists(fx.user1.token, fx.leagueId, fx.team1Id);
    const theirs = await rosterArtists(fx.user1.token, fx.leagueId, fx.team2Id);
    const give = mine.find((a) => a.primaryGenre === 'Pop')!;
    const receive = theirs.find((a) => a.primaryGenre === 'Pop')!;
    await apiPost(fx.user1.token, `/api/leagues/${fx.leagueId}/trades`, {
      toTeamId: fx.team2Id, give: [give.id], receive: [receive.id], drops: [],
    });

    const ctx = await browser.newContext();
    await injectAuth(ctx, fx.user2.token);
    const page = await ctx.newPage();
    await page.goto(`/leagues/${fx.leagueId}`);

    // Unseen badge on the tab before opening
    const tabButton = page.getByRole('button', { name: /Notifications/ });
    await expect(tabButton.locator('span.rounded-full')).toBeVisible({ timeout: 10_000 });

    await tabButton.click();
    await expect(page.getByText('proposed a trade')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('For you').first()).toBeVisible();
    await expect(page.getByText('View offer →')).toBeVisible();

    // Opening the tab marks everything seen — the badge disappears
    await expect(tabButton.locator('span.rounded-full')).not.toBeVisible({ timeout: 10_000 });
    await ctx.close();
  });

  test('waiver claim resolves through the finalize into feed events and reminders', async ({ browser }) => {
    // Queue a waiver claim via the real API: any free agent fits a bench slot.
    const players = await apiGet<{ id: string; name: string; rosteredBy: unknown }[]>(
      fx.user1.token, `/api/leagues/${fx.leagueId}/players`,
    );
    const freeAgent = players.find((p) => !p.rosteredBy)!;
    await apiPost(fx.user1.token, `/api/leagues/${fx.leagueId}/roster/claim`, {
      artistId: freeAgent.id,
      dropSlot: 'Bench-1',
    });

    const ctx = await browser.newContext();
    await injectAuth(ctx, fx.user1.token);
    const page = await ctx.newPage();

    // Before the finalize, the claim produces no feed event — it's only queued.
    await page.goto(`/leagues/${fx.leagueId}`);
    await page.getByRole('button', { name: /Notifications/ }).click();
    await expect(page.getByText('Nothing yet. League activity will show up here.')).toBeVisible({ timeout: 10_000 });

    // Sunday night: the week finalizes, resolving the claim.
    await apiPost('', '/api/test/finalize-week', { leagueId: fx.leagueId });

    await page.reload();
    await page.getByRole('button', { name: /Notifications/ }).click();

    // Week recap + lineup reminder + waiver resolution, all in the feed
    await expect(page.getByText(/Week 1 final:/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/set your lineup/i).first()).toBeVisible();
    await expect(page.getByText(`E2E Team A claimed ${freeAgent.name} off waivers`, { exact: false })).toBeVisible();
    await expect(page.getByText('Your waiver claim went through', { exact: false })).toBeVisible();
    await expect(page.getByText('For you').first()).toBeVisible();
    await ctx.close();
  });
});
