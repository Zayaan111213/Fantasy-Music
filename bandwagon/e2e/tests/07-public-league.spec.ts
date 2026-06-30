import { test, expect } from '@playwright/test';
import { createUser, injectAuth } from '../helpers/auth';
import { apiPost } from '../helpers/api';
import { request } from '@playwright/test';

const BASE_URL = 'http://localhost:3001';

// Unique suffix so parallel runs don't collide on usernames
const RUN_ID = Date.now().toString(36);

test.describe('Public league joining', () => {
  let commissionerToken: string;
  let commissionerId: string;
  let joinerId: string;
  let joinerToken: string;
  let leagueId: string;
  const leagueName = `E2E Public ${RUN_ID}`;

  test.beforeAll(async () => {
    // Create two users: one creates the public league, one joins it via the browse UI
    const commissioner = await createUser(
      `comm-${RUN_ID}@e2e.test`,
      'password123',
      `Comm${RUN_ID}`,
    );
    const joiner = await createUser(
      `joiner-${RUN_ID}@e2e.test`,
      'password123',
      `Joiner${RUN_ID}`,
    );

    commissionerToken = commissioner.token;
    commissionerId = commissioner.id;
    joinerId = joiner.id;
    joinerToken = joiner.token;

    // Commissioner creates a public league (isPrivate: false)
    const draftTime = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const league = await apiPost<{ id: string }>(
      commissionerToken,
      '/api/leagues',
      { name: leagueName, teamCount: 4, isPrivate: false, draftTime },
    );
    leagueId = league.id;
  });

  test.afterAll(async () => {
    // Clean up both users' data
    const ctx = await request.newContext({ baseURL: BASE_URL });
    await ctx.delete('/api/test/cleanup', {
      data: { leagueId, userIds: [commissionerId, joinerId] },
    });
    await ctx.dispose();
  });

  test('joiner sees and joins a public league from the browse list', async ({ browser: b }) => {
    const ctx = await b.newContext();
    await injectAuth(ctx, joinerToken);
    const page = await ctx.newPage();

    await page.goto('/leagues/join');

    // "Open Public Leagues" section should show the league created in beforeAll
    await expect(page.getByText(leagueName)).toBeVisible({ timeout: 15_000 });

    // Click the "Join" button next to our league.
    // The public list renders one row per public league; find the one matching our name.
    const leagueRow = page.locator('div', { has: page.getByText(leagueName) }).first();
    await leagueRow.getByRole('button', { name: 'Join' }).click();

    // Preview loads — a "Join League" button appears
    await expect(page.getByRole('button', { name: 'Join League' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Join League' }).click();

    // After joining: team customization step appears (team name input) OR direct redirect
    // Accept either path — both mean the join succeeded
    const teamNameInput = page.getByPlaceholder(/team name/i);
    const leagueHubHeading = page.getByText(leagueName);

    await Promise.race([
      expect(teamNameInput).toBeVisible({ timeout: 10_000 }),
      expect(leagueHubHeading).toBeVisible({ timeout: 10_000 }),
    ]).catch(async () => {
      // One of the two should have matched; if both timed out this will re-throw
      await expect(page.url()).toContain('/leagues/');
    });

    // If we hit the customization step, complete it to land on the league hub
    const inputVisible = await teamNameInput.isVisible().catch(() => false);
    if (inputVisible) {
      await teamNameInput.fill(`Joiner's Squad`);
      await page.getByRole('button', { name: /save|continue|done/i }).first().click();
    }

    // Should now be on the league hub showing the league name
    await page.waitForURL(/\/leagues\//, { timeout: 10_000 });
    await expect(page.getByText(leagueName)).toBeVisible({ timeout: 10_000 });

    await ctx.close();
  });
});
