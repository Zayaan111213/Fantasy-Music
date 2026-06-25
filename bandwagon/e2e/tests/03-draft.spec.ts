import { test, expect } from '@playwright/test';
import { createUser, injectAuth } from '../helpers/auth';
import { apiPost } from '../helpers/api';

test.describe('Live draft', () => {
  let commissioner: { id: string; token: string };
  let player: { id: string; token: string };
  let leagueId: string;
  let inviteCode: string;

  test.beforeAll(async () => {
    const ts = Date.now();
    const u1 = await createUser(`e2e-draft-comm-${ts}@test.internal`, 'testpass123', `draftcomm${ts}`.slice(0, 20));
    const u2 = await createUser(`e2e-draft-player-${ts}@test.internal`, 'testpass123', `draftplay${ts}`.slice(0, 20));
    commissioner = { id: u1.id, token: u1.token };
    player = { id: u2.id, token: u2.token };

    // Create league
    const draftTime = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const league = await apiPost<{ id: string; inviteCode: string }>(commissioner.token, '/api/leagues', {
      name: 'E2E Draft League',
      teamCount: 4,
      privacy: 'private',
      draftTime,
    });
    leagueId = league.id;
    inviteCode = league.inviteCode;

    // Player joins
    await apiPost(player.token, `/api/leagues/join/${inviteCode}`);

    // Start draft (transitions to pre_draft)
    await apiPost(commissioner.token, `/api/leagues/${leagueId}/draft/start`);
  });

  test('two users complete a full draft', async ({ browser: b }) => {
    // Open two isolated contexts — one per user
    const ctx1 = await b.newContext();
    const ctx2 = await b.newContext();
    await injectAuth(ctx1, commissioner.token);
    await injectAuth(ctx2, player.token);

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    await Promise.all([
      page1.goto(`/leagues/${leagueId}/draft`),
      page2.goto(`/leagues/${leagueId}/draft`),
    ]);

    // Both pages should show the pre-draft countdown
    await expect(page1.getByText('Draft starting in')).toBeVisible({ timeout: 15_000 });
    await expect(page1.getByRole('button', { name: 'Start Now' })).toBeVisible();

    // Commissioner skips the countdown
    await page1.getByRole('button', { name: 'Start Now' }).click();

    // Both pages transition to the live timer (Round 1 · Pick 1)
    await expect(page1.getByText(/Round 1 · Pick 1/)).toBeVisible({ timeout: 15_000 });
    await expect(page2.getByText(/Round 1/)).toBeVisible({ timeout: 15_000 });

    const TOTAL_PICKS = 18; // 2 teams × 9 slots

    for (let i = 0; i < TOTAL_PICKS; i++) {
      // Wait for "Your pick!" to appear on either page before deciding who's on clock.
      // .isVisible() is non-blocking so check only after one page has the text.
      await Promise.race([
        page1.getByText('Your pick!').waitFor({ state: 'visible', timeout: 15_000 }),
        page2.getByText('Your pick!').waitFor({ state: 'visible', timeout: 15_000 }),
      ]);
      const p1Turn = await page1.getByText('Your pick!').isVisible();
      const onClock = p1Turn ? page1 : page2;
      const offClock = p1Turn ? page2 : page1;

      // Confirm the on-clock page is ready
      await expect(onClock.getByText('Your pick!')).toBeVisible({ timeout: 5_000 });

      // Wait for the first enabled Draft button (artist list may still be loading)
      const draftBtn = onClock.locator('button:not([disabled])').filter({ hasText: 'Draft' }).first();
      await draftBtn.waitFor({ state: 'visible', timeout: 10_000 });
      await draftBtn.click();

      if (i < TOTAL_PICKS - 1) {
        // Wait for the pick count to advance on the off-clock page (socket propagation)
        await expect(offClock.getByText(`#${i + 1}`).last()).toBeVisible({ timeout: 10_000 });
      }
    }

    // Draft complete — both pages should show the toast and redirect
    await expect(page1.getByText('Draft complete! Rosters are set.')).toBeVisible({ timeout: 15_000 });
    await page1.waitForURL(`**/leagues/${leagueId}`, { timeout: 10_000 });

    await ctx1.close();
    await ctx2.close();
  });
});
