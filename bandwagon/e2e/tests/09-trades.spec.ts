import { test, expect } from '@playwright/test';
import { injectAuth } from '../helpers/auth';
import { apiGet, apiPost, setupActiveLeague, teardownLeague, type ActiveLeagueFixture } from '../helpers/api';

interface RosterTeam {
  id: string;
  name: string;
  userId: string;
  rosterSpots: { slot: string; artist: { id: string; name: string; primaryGenre: string } | null }[];
}

async function rosterArtists(token: string, leagueId: string, teamId: string) {
  const teams = await apiGet<RosterTeam[]>(token, `/api/leagues/${leagueId}/teams-with-rosters`);
  const team = teams.find((t) => t.id === teamId)!;
  return team.rosterSpots.filter((s) => s.artist).map((s) => s.artist!);
}

// Same-genre picks keep every trade in these tests trivially slot-legal
// (an off-genre swap can legitimately be rejected when it would strand a
// genre slot with no eligible player).
function byGenre(artists: { primaryGenre: string }[], genre: string) {
  return artists.filter((a) => a.primaryGenre === genre);
}

test.describe('Trades', () => {
  let fx: ActiveLeagueFixture;

  test.beforeAll(async () => {
    fx = await setupActiveLeague();
  });

  test.afterAll(async () => {
    await teardownLeague(fx.leagueId, [fx.user1.id, fx.user2.id, fx.user3.id, fx.user4.id]);
  });

  test('players-tab trade icon opens a pre-targeted propose modal', async ({ browser }) => {
    const ctx = await browser.newContext();
    await injectAuth(ctx, fx.user1.token);
    const page = await ctx.newPage();

    await page.goto(`/leagues/${fx.leagueId}`);
    await page.getByRole('button', { name: 'Players' }).click();
    await expect(page.getByText('Free Agents Only')).toBeVisible({ timeout: 10_000 });

    // Icon appears only on artists rostered by other teams
    const tradeIcon = page.getByRole('button', { name: /Propose trade for/ }).first();
    await expect(tradeIcon).toBeVisible({ timeout: 10_000 });
    await tradeIcon.click();

    // Jumps to My Team with the propose modal open and a team pre-selected
    await expect(page.getByText('Pick a team, then select players on both sides')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.fixed select')).not.toHaveValue('');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await ctx.close();
  });

  test('full flow: propose in UI, accept in UI, sub-threshold veto, executes at finalize', async ({ browser }) => {
    // --- user1 proposes to Team B via the modal ---
    const ctx1 = await browser.newContext();
    await injectAuth(ctx1, fx.user1.token);
    const page1 = await ctx1.newPage();
    // A same-genre 1-for-1 (Pop for Pop) is always slot-legal
    const minePop = byGenre(await rosterArtists(fx.user1.token, fx.leagueId, fx.team1Id), 'Pop')[0];
    const theirsPop = byGenre(await rosterArtists(fx.user1.token, fx.leagueId, fx.team2Id), 'Pop')[0];

    await page1.goto(`/leagues/${fx.leagueId}`);
    await expect(page1.getByText('Trades', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page1.getByRole('button', { name: 'Propose Trade' }).click();
    await page1.locator('.fixed select').selectOption(fx.team2Id);

    const columns = page1.locator('.fixed .grid > div');
    await columns.nth(0).getByRole('button', { name: new RegExp(minePop.name) }).click();
    await columns.nth(1).getByRole('button', { name: new RegExp(theirsPop.name) }).click();

    const [proposeRes] = await Promise.all([
      page1.waitForResponse((r) => r.url().includes('/trades') && r.request().method() === 'POST', { timeout: 15_000 }),
      page1.locator('.fixed').getByRole('button', { name: 'Propose Trade' }).click(),
    ]);
    expect(proposeRes.status()).toBe(200);
    await expect(page1.getByText('Pending')).toBeVisible({ timeout: 10_000 });
    await ctx1.close();

    // --- user2 accepts via the modal (1-for-1, no drops) ---
    const ctx2 = await browser.newContext();
    await injectAuth(ctx2, fx.user2.token);
    const page2 = await ctx2.newPage();
    await page2.goto(`/leagues/${fx.leagueId}`);
    await expect(page2.getByText('Pending')).toBeVisible({ timeout: 10_000 });
    await page2.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(page2.getByText('No drops needed', { exact: false })).toBeVisible({ timeout: 5_000 });
    const [acceptRes] = await Promise.all([
      page2.waitForResponse((r) => r.url().includes('/accept') && r.request().method() === 'POST', { timeout: 15_000 }),
      page2.getByRole('button', { name: 'Accept Trade' }).click(),
    ]);
    expect(acceptRes.status()).toBe(200);
    await expect(page2.getByText('Accepted · executes Sunday night')).toBeVisible({ timeout: 10_000 });
    await ctx2.close();

    // --- user3 vetoes (1 of 2 — not unanimous, trade survives) ---
    const ctx3 = await browser.newContext();
    await injectAuth(ctx3, fx.user3.token);
    const page3 = await ctx3.newPage();
    await page3.goto(`/leagues/${fx.leagueId}`);
    await expect(page3.getByText('0 of 2 vetoes')).toBeVisible({ timeout: 10_000 });
    await page3.getByRole('button', { name: 'Veto' }).click();
    await expect(page3.getByText('1 of 2 vetoes')).toBeVisible({ timeout: 10_000 });
    await expect(page3.getByText('You voted to veto')).toBeVisible();
    await page3.screenshot({ path: test.info().outputPath('trade-veto-tally.png'), fullPage: true });
    await ctx3.close();

    // --- the accepted trade's artists are locked against free-agent drops ---
    const tradesNow = await apiGet<{ trades: { status: string; items: { artistId: string; fromTeamId: string }[] }[] }>(
      fx.user1.token, `/api/leagues/${fx.leagueId}/trades`,
    );
    const accepted = tradesNow.trades.find((t) => t.status === 'accepted')!;
    const lockedMine = accepted.items.find((i) => i.fromTeamId === fx.team1Id)!;
    const myRoster = await apiGet<{ rosterSpots: { slot: string; artistId: string | null }[] }>(
      fx.user1.token, `/api/leagues/${fx.leagueId}/roster`,
    );
    const lockedSlot = myRoster.rosterSpots.find((s) => s.artistId === lockedMine.artistId)!.slot;
    const players = await apiGet<{ id: string; rosteredBy: unknown }[]>(
      fx.user1.token, `/api/leagues/${fx.leagueId}/players`,
    );
    const freeAgent = players.find((p) => !p.rosteredBy)!;
    await expect(async () => {
      await apiPost(fx.user1.token, `/api/leagues/${fx.leagueId}/roster/claim`, {
        artistId: freeAgent.id,
        dropSlot: lockedSlot,
      });
    }).rejects.toThrow(/locked in an accepted trade/);

    // --- finalize the week: the accepted trade executes and rosters swap ---
    const gave = lockedMine.artistId;
    const received = accepted.items.find((i) => i.fromTeamId === fx.team2Id)!.artistId;
    await apiPost('', '/api/test/finalize-week', { leagueId: fx.leagueId });

    const myAfter = await rosterArtists(fx.user1.token, fx.leagueId, fx.team1Id);
    const theirAfter = await rosterArtists(fx.user1.token, fx.leagueId, fx.team2Id);
    expect(myAfter.map((r) => r.id)).toContain(received);
    expect(myAfter.map((r) => r.id)).not.toContain(gave);
    expect(theirAfter.map((r) => r.id)).toContain(gave);
    expect(theirAfter.map((r) => r.id)).not.toContain(received);

    const after = await apiGet<{ trades: { status: string }[] }>(fx.user1.token, `/api/leagues/${fx.leagueId}/trades`);
    expect(after.trades[0].status).toBe('executed');
  });

  test('uneven trade requires drops; unanimous veto kills it; rosters untouched', async ({ browser }) => {
    // API-driven: user1 gives 1, receives 2 → must drop 1 at propose time.
    // Same-genre picks (give Pop + drop Pop for their Pop + R&B) keep it legal.
    const mine = await rosterArtists(fx.user1.token, fx.leagueId, fx.team1Id);
    const theirs = await rosterArtists(fx.user1.token, fx.leagueId, fx.team2Id);
    const give = byGenre(mine, 'Pop')[0];
    const drop = byGenre(mine, 'Pop')[1];
    const receive = [byGenre(theirs, 'Pop')[0], byGenre(theirs, 'R&B/Hip-Hop')[0]];

    // Missing drop → 400 with the exact count
    await expect(async () => {
      await apiPost(fx.user1.token, `/api/leagues/${fx.leagueId}/trades`, {
        toTeamId: fx.team2Id, give: [give.id], receive: receive.map((r) => r.id), drops: [],
      });
    }).rejects.toThrow(/drop exactly 1/);

    const proposed = await apiPost<{ id: string }>(fx.user1.token, `/api/leagues/${fx.leagueId}/trades`, {
      toTeamId: fx.team2Id, give: [give.id], receive: receive.map((r) => r.id), drops: [drop.id],
    });
    await apiPost(fx.user2.token, `/api/leagues/${fx.leagueId}/trades/${proposed.id}/accept`, { drops: [] });

    // Unanimous veto: both non-involved members vote
    const v1 = await apiPost<{ vetoed: boolean }>(fx.user3.token, `/api/leagues/${fx.leagueId}/trades/${proposed.id}/veto`, {});
    expect(v1.vetoed).toBe(false);
    const v2 = await apiPost<{ vetoed: boolean }>(fx.user4.token, `/api/leagues/${fx.leagueId}/trades/${proposed.id}/veto`, {});
    expect(v2.vetoed).toBe(true);

    // Finalize the (new) current week: the vetoed trade must not move players
    const before = (await rosterArtists(fx.user1.token, fx.leagueId, fx.team1Id)).map((r) => r.id).sort();
    await apiPost('', '/api/test/finalize-week', { leagueId: fx.leagueId });
    const afterIds = (await rosterArtists(fx.user1.token, fx.leagueId, fx.team1Id)).map((r) => r.id).sort();
    expect(afterIds).toEqual(before);

    const list = await apiGet<{ trades: { id: string; status: string }[] }>(fx.user1.token, `/api/leagues/${fx.leagueId}/trades`);
    expect(list.trades.find((t) => t.id === proposed.id)!.status).toBe('vetoed');
  });
});
