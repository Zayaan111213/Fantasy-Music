import { test, expect } from '@playwright/test';
import { injectAuth } from '../helpers/auth';
import { apiGet, apiPost, setupActiveLeague, teardownLeague, type ActiveLeagueFixture } from '../helpers/api';

test.describe('Waiver claims', () => {
  let fixture: ActiveLeagueFixture;

  test.beforeAll(async () => {
    fixture = await setupActiveLeague();
  });

  test.afterAll(async () => {
    await teardownLeague(fixture.leagueId, [
      fixture.user1.id, fixture.user2.id, fixture.user3.id, fixture.user4.id,
    ]);
  });

  test('waiver claim from the Players tab: queued, then resolved at finalize', async ({ browser: b }) => {
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
    const firstClaimButton = page.getByRole('button', { name: 'Claim', exact: true }).first();
    await expect(firstClaimButton).toBeVisible({ timeout: 10_000 });

    // Capture the artist name shown in the same row as the Claim button.
    const artistRow = firstClaimButton.locator('../..').first();
    const artistNameBefore = await artistRow.locator('a').first().textContent();
    const claimedName = artistNameBefore?.trim() ?? '';
    expect(claimedName).not.toBe('');

    // Click Claim — modal opens; waiver copy is shown
    await firstClaimButton.click();
    await expect(page.getByText('Select a player to drop · claims process Sunday night')).toBeVisible({ timeout: 5_000 });

    // Click the first eligible drop slot in the modal's scrollable section
    const dropScrollArea = page.locator('.fixed .overflow-y-auto').first();
    const firstDropOption = dropScrollArea.locator('button').first();
    await expect(firstDropOption).toBeVisible({ timeout: 5_000 });
    await firstDropOption.click();

    // Submit becomes enabled after selecting a drop slot
    const confirmButton = page.getByRole('button', { name: 'Submit Waiver Claim' });
    await expect(confirmButton).toBeEnabled({ timeout: 3_000 });

    const [claimResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/roster/claim') && res.request().method() === 'POST',
        { timeout: 15_000 }
      ),
      confirmButton.click(),
    ]);
    expect(claimResponse.status()).toBe(200);

    // Modal closes; NOTHING moves yet — the claim is queued:
    await expect(page.getByText('Select a player to drop · claims process Sunday night')).not.toBeVisible({ timeout: 5_000 });
    // Pending-claims card lists the artist with the user's waiver position
    await expect(page.getByText('Pending waiver claims')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Waiver position #1/)).toBeVisible();
    // The artist row now shows the amber pending pill instead of a Claim button
    await expect(page.getByText('Claimed', { exact: true }).first()).toBeVisible();
    // And the artist is still in the free-agent list (roster unchanged until Sunday)
    await expect(page.getByText(claimedName).first()).toBeVisible();

    // --- Sunday night: finalize the week; the claim resolves ---
    await apiPost('', '/api/test/finalize-week', { leagueId: fixture.leagueId });

    await page.reload();
    await page.getByRole('button', { name: 'Players' }).click();
    await expect(page.getByText('Free Agents Only')).toBeVisible({ timeout: 10_000 });
    await page.getByText('Free Agents Only').click();

    // Claim resolved: no pending card, artist no longer a free agent
    await expect(page.getByText('Pending waiver claims')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Claim', exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(claimedName)).not.toBeVisible();

    await ctx.close();
  });

  test('claims appear in My Team and can be reprioritized', async ({ browser: b }) => {
    // user2 queues two claims via the API (bench slots take any genre).
    const players = await apiGet<{ id: string; name: string; rosteredBy: unknown }[]>(
      fixture.user2.token, `/api/leagues/${fixture.leagueId}/players`,
    );
    const freeAgents = players.filter((p) => !p.rosteredBy).slice(0, 2);
    const [first, second] = freeAgents;
    await apiPost(fixture.user2.token, `/api/leagues/${fixture.leagueId}/roster/claim`, {
      artistId: first.id, dropSlot: 'Bench-1',
    });
    await apiPost(fixture.user2.token, `/api/leagues/${fixture.leagueId}/roster/claim`, {
      artistId: second.id, dropSlot: 'Bench-2',
    });

    const ctx = await b.newContext();
    await injectAuth(ctx, fixture.user2.token);
    const page = await ctx.newPage();
    await page.goto(`/leagues/${fixture.leagueId}`);

    // The pending-claims card is on the My Team tab (the default tab)
    await expect(page.getByText('Pending waiver claims')).toBeVisible({ timeout: 10_000 });
    const rowFor = (name: string) =>
      page.locator('div.flex.items-center.gap-3.p-3', { hasText: name });
    const priorityOf = (name: string) => rowFor(name).locator('span').first();
    await expect(priorityOf(first.name)).toHaveText('1');
    await expect(priorityOf(second.name)).toHaveText('2');

    // Move the second claim up — order swaps
    await page.getByRole('button', { name: `Move ${second.name} up` }).click();
    await expect(priorityOf(second.name)).toHaveText('1', { timeout: 10_000 });
    await expect(priorityOf(first.name)).toHaveText('2');

    // The API reflects the new order
    const waivers = await apiGet<{ claims: { artist: { id: string } }[] }>(
      fixture.user2.token, `/api/leagues/${fixture.leagueId}/waivers`,
    );
    expect(waivers.claims.map((c) => c.artist.id)).toEqual([second.id, first.id]);

    // Clean up so later tests aren't affected by user2's pending claims
    for (const claim of (await apiGet<{ claims: { id: string }[] }>(
      fixture.user2.token, `/api/leagues/${fixture.leagueId}/waivers`,
    )).claims) {
      await apiPost(fixture.user2.token, `/api/leagues/${fixture.leagueId}/waivers/${claim.id}/cancel`, {});
    }
    await ctx.close();
  });

  test('conflicting claims: higher waiver priority wins, loser is notified', async ({ browser: b }) => {
    // Find a free agent both teams can legally claim into Bench-2.
    const players = await apiGet<{ id: string; name: string; rosteredBy: unknown }[]>(
      fixture.user1.token, `/api/leagues/${fixture.leagueId}/players`,
    );
    const target = players.find((p) => !p.rosteredBy)!;

    // Team D (waiver priority 4) claims first; Team C (priority 3) claims later —
    // priority beats submission order.
    await apiPost(fixture.user4.token, `/api/leagues/${fixture.leagueId}/roster/claim`, {
      artistId: target.id, dropSlot: 'Bench-2',
    });
    await apiPost(fixture.user3.token, `/api/leagues/${fixture.leagueId}/roster/claim`, {
      artistId: target.id, dropSlot: 'Bench-2',
    });

    await apiPost('', '/api/test/finalize-week', { leagueId: fixture.leagueId });

    // Team C won the artist
    const teams = await apiGet<{ id: string; rosterSpots: { artist: { id: string } | null }[] }[]>(
      fixture.user3.token, `/api/leagues/${fixture.leagueId}/teams-with-rosters`,
    );
    const teamC = teams.find((t) => t.id === fixture.team3Id)!;
    expect(teamC.rosterSpots.some((s) => s.artist?.id === target.id)).toBe(true);

    // Team D lost — sees the losing notification in the feed
    const ctx = await b.newContext();
    await injectAuth(ctx, fixture.user4.token);
    const page = await ctx.newPage();
    await page.goto(`/leagues/${fixture.leagueId}`);
    await page.getByRole('button', { name: /Notifications/ }).click();
    await expect(page.getByText(`waiver claim for ${target.name} was lost`, { exact: false })).toBeVisible({ timeout: 10_000 });

    // Team C dropped to the bottom of the waiver order in the standings
    await page.getByRole('button', { name: 'Standings' }).click();
    await expect(page.getByText('Waiver', { exact: true })).toBeVisible({ timeout: 10_000 });
    const cRow = page.locator('div.grid.grid-cols-12', { hasText: 'E2E Team C' }).last();
    await expect(cRow.locator('> div').last()).toHaveText('4'); // waiver column is the last cell

    await ctx.close();
  });
});
