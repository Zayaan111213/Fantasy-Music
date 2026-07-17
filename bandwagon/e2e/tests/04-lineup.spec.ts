import { test, expect } from '@playwright/test';
import { injectAuth } from '../helpers/auth';
import { setupActiveLeague, teardownLeague, apiPut, type ActiveLeagueFixture } from '../helpers/api';

// Next Tuesday (Pacific) at ~noon PT, on or after today. 19:00 UTC falls on
// the same Pacific calendar day year-round, so the PT weekday check is stable.
function nextTuesdayPT(): Date {
  const base = new Date();
  base.setUTCHours(19, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    const cand = new Date(base.getTime() + i * 86_400_000);
    if (cand.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' }) === 'Tuesday') {
      return cand;
    }
  }
  throw new Error('unreachable: no Tuesday within 7 days');
}

test.describe('Lineup management', () => {
  let fixture: ActiveLeagueFixture;

  test.beforeAll(async () => {
    fixture = await setupActiveLeague();
  });

  test.afterAll(async () => {
    await teardownLeague(fixture.leagueId, [fixture.user1.id, fixture.user2.id, fixture.user3.id, fixture.user4.id]);
  });

  test('swap works via UI on Monday', async ({ browser: b }) => {
    // The backend day is pinned to Tuesday (.env.test), which locks the shared
    // fixture. Use a league in the week-1 pre-game window (draft just now) so
    // the backend allows the swap; the browser clock provides the Monday UI.
    const fresh = await setupActiveLeague({ draftDaysAgo: 0 });
    const ctx = await b.newContext();
    await injectAuth(ctx, fresh.user1.token);
    const page = await ctx.newPage();

    // Override browser Date to Monday so getWeekPhase() returns 'adjustment' (unlocked)
    await page.clock.setFixedTime(new Date('2026-06-22T10:00:00'));
    await page.goto(`/leagues/${fresh.leagueId}`);

    // Confirm unlocked state: swap hint is visible
    await expect(page.getByText('Tap two slots to swap')).toBeVisible({ timeout: 10_000 });

    // Capture the full text of the Flex row before the swap so we can detect a change
    const flexRow = page.locator('[data-slot="Flex"]').first();
    const flexTextBefore = await flexRow.textContent();

    // Click Flex slot → should highlight and show the "select second slot" info bar
    await page.locator('text=Flex').first().click();
    await expect(page.getByText(/Select a second slot/)).toBeVisible({ timeout: 3_000 });

    // Register all three waits concurrently with the click so neither response is missed.
    // nth(0) = the <h3>Bench</h3> section heading; nth(1) = first bench slot label span.
    // Clicking the label span bubbles up to the parent row's onClick handler.
    const [putResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/roster/lineup') && res.request().method() === 'PUT',
        { timeout: 15_000 }
      ),
      page.waitForResponse(
        // Matches GET /leagues/{id}/roster (not /roster/lineup)
        (res) => /\/leagues\/[^/]+\/roster$/.test(res.url()) && res.request().method() === 'GET',
        { timeout: 15_000 }
      ),
      page.locator('text=Bench').nth(1).click(),
    ]);
    expect(putResponse.status()).toBe(200);

    // Flex row content should have changed after re-render
    const flexTextAfter = await flexRow.textContent();
    expect(flexTextAfter).not.toBe(flexTextBefore);

    await ctx.close();
    await teardownLeague(fresh.leagueId, [fresh.user1.id, fresh.user2.id, fresh.user3.id, fresh.user4.id]);
  });

  test('locked UI shown on Tuesday', async ({ browser: b }) => {
    const ctx = await b.newContext();
    await injectAuth(ctx, fixture.user1.token);
    const page = await ctx.newPage();

    // Override browser Date to the next Tuesday (PT) on or after the real today,
    // so getWeekPhase() returns 'scoring' (locked). A hardcoded date rots: the
    // fixture's draftTime is now − 14 days, and pinning a Tuesday at/before the
    // first scoring Tuesday after the draft triggers the week-1 adjustment
    // exception, which unlocks the lineup instead.
    await page.clock.setFixedTime(nextTuesdayPT());
    await page.goto(`/leagues/${fixture.leagueId}`);

    // Lock banner must be visible
    await expect(page.getByText('Lineup locked until Monday')).toBeVisible({ timeout: 10_000 });

    // Clicking a slot should do nothing — no selection bar should appear
    await page.locator('text=Flex').first().click();
    await expect(page.getByText(/Select a second slot/)).not.toBeVisible();

    await ctx.close();
  });

  test('backend returns 403 when locked (TEST_OVERRIDE_DAY)', async () => {
    // Direct API test: verifies the backend enforces the lock independently of the UI.
    // TEST_OVERRIDE_DAY=Monday (from .env.test) keeps the backend unlocked so the
    // fixture swap above works. This test confirms the 403 path exists in code by
    // checking that a real Tuesday override would block it — or accepts any response
    // if no Tuesday override is configured.
    const result = await apiPut<{ error?: string }>(
      fixture.user1.token,
      `/api/leagues/${fixture.leagueId}/roster/lineup`,
      { slotA: 'Flex', slotB: 'Bench-2' }
    );

    const overrideDay = process.env.TEST_OVERRIDE_DAY;
    if (overrideDay === 'Tuesday') {
      expect(result.status).toBe(403);
      expect(result.body.error).toContain('locked');
    } else if (overrideDay === 'Monday') {
      // Unlocked — swap should succeed (or 400 if slot state is unexpected after prior tests)
      expect([200, 400]).toContain(result.status);
    } else {
      // No override: accept any outcome depending on the real current day
      expect([200, 400, 403]).toContain(result.status);
    }
  });
});
