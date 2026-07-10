import { test, expect } from '@playwright/test';
import { injectAuth } from '../helpers/auth';
import { apiGet, setupActiveLeague, teardownLeague, type ActiveLeagueFixture } from '../helpers/api';

// Free agency: while the lineup is adjustable, pickups are instant and free.
// The fixture league drafts "just now", putting it in the week-1 pre-game
// window — lineup-adjustable on any real day, with the backend day pinned to
// Tuesday. This exercises the same isLineupLocked rule Monday uses.
test.describe('Free agency while the lineup is adjustable', () => {
  let fx: ActiveLeagueFixture;

  test.beforeAll(async () => {
    fx = await setupActiveLeague({ draftDaysAgo: 0 });
  });

  test.afterAll(async () => {
    await teardownLeague(fx.leagueId, [fx.user1.id, fx.user2.id, fx.user3.id, fx.user4.id]);
  });

  test('pickup is instant, costs no waiver position, and hits the feed', async ({ browser: b }) => {
    const ctx = await b.newContext();
    await injectAuth(ctx, fx.user1.token);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fx.leagueId}`);
    await page.getByRole('button', { name: 'Players' }).click();
    await expect(page.getByText('Free Agents Only')).toBeVisible({ timeout: 10_000 });
    await page.getByText('Free Agents Only').click();

    const firstClaimButton = page.getByRole('button', { name: 'Claim', exact: true }).first();
    await expect(firstClaimButton).toBeVisible({ timeout: 10_000 });
    const artistRow = firstClaimButton.locator('../..').first();
    const claimedName = (await artistRow.locator('a').first().textContent())?.trim() ?? '';
    expect(claimedName).not.toBe('');

    // Modal shows free-agency copy (week-1 window ⇒ phase is 'adjustment')
    await firstClaimButton.click();
    await expect(page.getByText('free agency is open, adds are instant')).toBeVisible({ timeout: 5_000 });

    const dropScrollArea = page.locator('.fixed .overflow-y-auto').first();
    await dropScrollArea.locator('button').first().click();
    const confirmButton = page.getByRole('button', { name: 'Add Free Agent' });
    await expect(confirmButton).toBeEnabled({ timeout: 3_000 });

    const [claimResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/roster/claim') && res.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      confirmButton.click(),
    ]);
    expect(claimResponse.status()).toBe(200);
    expect(await claimResponse.json()).toMatchObject({ instant: true });

    // Instant: artist leaves the free-agent list, and nothing is queued
    await expect(page.getByText(claimedName)).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Pending waiver claims')).not.toBeVisible();

    // The pickup was free — user1 keeps waiver position 1
    const waivers = await apiGet<{ waiverPosition: number }>(
      fx.user1.token, `/api/leagues/${fx.leagueId}/waivers`,
    );
    expect(waivers.waiverPosition).toBe(1);

    // Feed shows the instant add
    await page.getByRole('button', { name: /Notifications/ }).click();
    await expect(page.getByText(`added ${claimedName}`, { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('(free agency)', { exact: false })).toBeVisible();

    await ctx.close();
  });
});
