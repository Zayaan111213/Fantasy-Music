import { test, expect, type Page } from '@playwright/test';
import { createUser, injectAuth } from '../helpers/auth';
import { apiPost, teardownLeague } from '../helpers/api';

test.describe('Live draft', () => {
  let commissioner: { id: string; token: string };
  let players: { id: string; token: string }[];
  let leagueId: string;
  let inviteCode: string;

  test.beforeAll(async () => {
    const ts = Date.now();
    const [u1, u2, u3, u4] = await Promise.all([
      createUser(`e2e-draft-comm-${ts}@test.internal`,  'testpass123', `draftcomm${ts}`.slice(0, 20)),
      createUser(`e2e-draft-p2-${ts}@test.internal`,    'testpass123', `draftp2${ts}`.slice(0, 20)),
      createUser(`e2e-draft-p3-${ts}@test.internal`,    'testpass123', `draftp3${ts}`.slice(0, 20)),
      createUser(`e2e-draft-p4-${ts}@test.internal`,    'testpass123', `draftp4${ts}`.slice(0, 20)),
    ]);
    commissioner = { id: u1.id, token: u1.token };
    players = [
      { id: u2.id, token: u2.token },
      { id: u3.id, token: u3.token },
      { id: u4.id, token: u4.token },
    ];

    // Commissioner creates a 4-team league (auto-joins as team 1)
    const draftTime = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const league = await apiPost<{ id: string; inviteCode: string }>(commissioner.token, '/api/leagues', {
      name: 'E2E Draft League',
      teamCount: 4,
      isPrivate: true,
      draftTime,
    });
    leagueId = league.id;
    inviteCode = league.inviteCode;

    // All 3 players join (creates teams 2, 3, 4)
    await Promise.all(players.map((p) => apiPost(p.token, `/api/leagues/join/${inviteCode}`)));

    // Transition to pre_draft (starts the 10-min countdown)
    await apiPost(commissioner.token, `/api/leagues/${leagueId}/draft/start`);
  });

  test.afterAll(async () => {
    if (leagueId) {
      await teardownLeague(leagueId, [commissioner.id, ...players.map((p) => p.id)]);
    }
  });

  test('four users complete a full 36-pick snake draft', async ({ browser: b }) => {
    // One isolated browser context per user
    const contexts = await Promise.all(
      [commissioner, ...players].map((u) => b.newContext().then(async (ctx) => {
        await injectAuth(ctx, u.token);
        return ctx;
      }))
    );
    const pages: Page[] = await Promise.all(contexts.map((ctx) => ctx.newPage()));

    await Promise.all(pages.map((p) => p.goto(`/leagues/${leagueId}/draft`)));

    // All pages see the pre-draft lobby
    await expect(pages[0].getByText('Draft starting in')).toBeVisible({ timeout: 15_000 });
    await expect(pages[0].getByRole('button', { name: 'Start Now' })).toBeVisible();

    // Commissioner skips the countdown → all pages transition to live draft
    await pages[0].getByRole('button', { name: 'Start Now' }).click();
    await expect(pages[0].getByText(/Round 1 · Pick 1/)).toBeVisible({ timeout: 15_000 });
    for (const p of pages.slice(1)) {
      await expect(p.getByText(/Round 1/)).toBeVisible({ timeout: 15_000 });
    }

    // Snake draft: 4 teams × 9 slots = 36 picks
    const TOTAL_PICKS = 36;

    for (let i = 0; i < TOTAL_PICKS; i++) {
      // The on-clock page shows "Your pick!" AND the current pick number.
      // Requiring both rules out the previous picker's page, whose stale
      // "Your pick!" survives until the socket broadcast lands (both texts
      // render from the same state object, so they update atomically).
      const pickLabel = `Pick ${i + 1} of ${TOTAL_PICKS}`;
      let onClock: Page | undefined;
      await expect
        .poll(async () => {
          for (const p of pages) {
            if (
              (await p.getByText(pickLabel).isVisible()) &&
              (await p.getByText('Your pick!').isVisible())
            ) { onClock = p; return true; }
          }
          return false;
        }, { timeout: 20_000, message: `No page on clock for pick ${i + 1}` })
        .toBe(true);
      if (!onClock) throw new Error(`No page on clock for pick ${i + 1}`);

      // Draft the first available artist
      const draftBtn = onClock.locator('button:not([disabled])').filter({ hasText: 'Draft' }).first();
      await draftBtn.waitFor({ state: 'visible', timeout: 10_000 });
      await draftBtn.click();

      // After any pick but the last, confirm at least one other page received the broadcast
      if (i < TOTAL_PICKS - 1) {
        const otherPage = pages.find((p) => p !== onClock)!;
        await expect(otherPage.getByText(`#${i + 1}`).last()).toBeVisible({ timeout: 10_000 });
      }
    }

    // Draft complete — the commissioner's page redirects to the league hub.
    // (The "Draft complete!" toast is transient and often gone before an
    // assertion can observe it, so assert the redirect and roster instead.)
    await pages[0].waitForURL(`**/leagues/${leagueId}`, { timeout: 15_000 });
    await expect(pages[0].getByRole('heading', { name: 'Starters' })).toBeVisible({ timeout: 10_000 });

    await Promise.all(contexts.map((ctx) => ctx.close()));
  });
});
