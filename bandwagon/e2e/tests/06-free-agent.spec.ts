import { test, expect } from '@playwright/test';
import { injectAuth } from '../helpers/auth';
import { setupActiveLeague, teardownLeague, type ActiveLeagueFixture } from '../helpers/api';

test.describe('Free agent claim', () => {
  let fixture: ActiveLeagueFixture;

  test.beforeAll(async () => {
    fixture = await setupActiveLeague();
  });

  test.afterAll(async () => {
    await teardownLeague(fixture.leagueId, [
      fixture.user1.id, fixture.user2.id, fixture.user3.id, fixture.user4.id,
    ]);
  });

  test('claims a free agent from the Players tab', async ({ browser: b }) => {
    const ctx = await b.newContext();
    await injectAuth(ctx, fixture.user1.token);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fixture.leagueId}`);

    // Navigate to the Players tab
    await page.getByRole('button', { name: 'Players' }).click();
    await expect(page.getByText('Free Agents Only')).toBeVisible({ timeout: 10_000 });

    // Filter to free agents so we know the first "Claim" button is for an unclaimed artist
    const freeAgentToggle = page.getByText('Free Agents Only');
    await freeAgentToggle.click();

    // Wait for the list to refresh and a Claim button to appear
    const firstClaimButton = page.getByRole('button', { name: 'Claim' }).first();
    await expect(firstClaimButton).toBeVisible({ timeout: 10_000 });

    // Capture the artist name shown in the same row as the Claim button.
    // The name is rendered as a <Link> (anchor), and the button's grandparent
    // is the row's 12-column grid container.
    const artistRow = firstClaimButton.locator('../..').first();
    const artistNameBefore = await artistRow.locator('a').first().textContent();

    // Click Claim — modal opens
    await firstClaimButton.click();

    // Modal header: "Claim {artistName}" and subtitle asking to pick a drop
    await expect(page.getByText('Select a player to drop')).toBeVisible({ timeout: 5_000 });

    // Click the first eligible drop slot in the modal's scrollable section
    // (scoped to the modal overlay so page-level scroll containers can't match)
    const dropScrollArea = page.locator('.fixed .overflow-y-auto').first();
    const firstDropOption = dropScrollArea.locator('button').first();
    await expect(firstDropOption).toBeVisible({ timeout: 5_000 });
    await firstDropOption.click();

    // "Confirm Claim" button becomes enabled after selecting a drop slot
    const confirmButton = page.getByRole('button', { name: 'Confirm Claim' });
    await expect(confirmButton).toBeEnabled({ timeout: 3_000 });

    // Submit the claim and wait for both the POST and the following players re-fetch
    const [claimResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/roster/claim') && res.request().method() === 'POST',
        { timeout: 15_000 }
      ),
      confirmButton.click(),
    ]);

    expect(claimResponse.status()).toBe(200);

    // Modal should close after a successful claim
    await expect(page.getByText('Select a player to drop')).not.toBeVisible({ timeout: 5_000 });

    // The claimed artist should no longer show a "Claim" button in the free-agent list
    // (it's now on a roster, so toggling free-agent filter back would hide it)
    // Re-enable free-agent filter and confirm the artist is gone from the list
    const claimedName = artistNameBefore?.trim();
    if (claimedName) {
      await expect(page.getByText(claimedName)).not.toBeVisible({ timeout: 10_000 });
    }

    await ctx.close();
  });
});
