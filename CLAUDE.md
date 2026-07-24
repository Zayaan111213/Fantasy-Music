# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Bandwagon** is a fantasy sports app for music. Users draft rosters of real recording artists and earn points each week based on real-world chart performance: chart position, chart movement, and longevity on the Apple Music Most Played charts. Friends compete head-to-head in private leagues. Full spec is in `PRD.md`.

## Tech Stack

- **Backend**: Node.js with TypeScript
- **Frontend**: React
- **Database**: PostgreSQL (relational — strongly recommended over alternatives given the data model)
- **Deployed**: Railway at https://bandwagon.up.railway.app

PostgreSQL is the right fit because the domain is deeply relational: users → leagues → teams → rosters → artists → weekly scores → matchups. The app relies on multi-table JOINs (standings, scoring rollups), transactions (roster adds must atomically drop another artist), and DB-level constraints as a safety net for slot-legality. Postgres window functions also simplify ranking and tier-table lookups in the scoring pipeline.

## Architecture Requirements (from PRD)

### Data Access Layer (mandatory abstraction)
The app **must not** call data providers directly from feature code. All external data must go through an internal data-access layer. This is a hard requirement — it enables provider swaps, fallbacks, and graceful degradation. If a source drops for a week, scoring must continue on available signals and flag the gap, never hard-fail the whole run.

### Scoring Engine
An artist's weekly score = **song chart position points + song movement points + album chart position points + album movement points + longevity points**. No streaming signal. All signals derive from the **Apple Music Most Played Songs chart (Top 100) and Apple Music Most Played Albums chart (Top 100)**. Week boundaries: **Tuesday 00:00 – Sunday 23:59 US Pacific**.

**Scoring tiers (song and album position use identical tiers):**
| Chart rank | Points |
|---|---|
| 1 | 25 |
| 2–10 | 18 |
| 11–25 | 12 |
| 26–50 | 8 |
| 51–100 | 4 |
| Not on chart | 0 |

**Chart movement:** new entry/debut = +10; +1 per position gained (cap +15); −1 per position lost (cap −10); **fell off a chart** (on it last week, gone this week) = −10 for that chart's movement signal (song and album penalized independently — off both after being on both = −20). Weekly totals can be negative.

**Longevity:** 0 pts for week 1 on chart; +2 pts per consecutive week starting week 2; capped at +10 (6+ consecutive weeks).

### Roster & Eligibility
9-artist rosters: 6 starters (R&B/Hip-Hop, Pop, Rock & Alternative, Country, Other, Flex slots) + 3 bench. Eligibility checks run at draft, on every add/drop, and on every trade. Multi-genre artists are classified by **primary genre only**. Any action leaving a roster slot-illegal must be rejected with a clear message.

### Draft
Live snake draft with a per-pick clock (default 60s). Before picks begin, a 10-minute lobby countdown runs (`pre_draft` status) — all members can see the timer, commissioner can skip it. Auto-draft on per-pick expiry selects the best available eligible artist for an open slot based on most recent week's points. Draft ends when every team fills all 9 slots.

### Season Structure
10-week regular season → round-robin head-to-head matchups → top 4 playoff (P1). Scores update on a daily provisional batch and finalize after each week closes (Monday ~00:01 PT).

### League Types
- **Private leagues**: invite-link only, commissioner-controlled settings
- **Public leagues**: listed on the join page, any user can join; commissioner still controls settings

### Key Domain Rules
- **Scoring week**: Tuesday 00:00 – Sunday 23:59 PT. Lineup locks at the start of the scoring week.
- **Adjustment window**: Monday (lineup editable, prev week scores shown for reference, win/loss popup).
- **Week 1 exception**: Lineup stays open from draft completion until the first Tuesday after `league.draftTime`. There is no game during this gap.
- Waivers: claims queue Tuesday–Sunday and resolve Sunday night at the finalize; conflicts go to the higher waiver order; winners drop to the bottom; initial order is reverse draft order; adds require a corresponding drop. On Monday (and the week-1 pre-game window) pickups are instant free agency with no waiver cost
- Trades must leave both rosters slot-legal; legality check is required before acceptance
- Commissioner settings lock after the season starts (with narrow exceptions); draft time locks once the league leaves `pending`
- Matchup tiebreaker: highest-scoring single artist
- Standings tiebreaker: total points-for

## Priority Tiers
- **P0** (core): Auth, leagues, artist database/genre tagging, draft, roster/lineup, matchups/standings, scoring, season structure
- **P1**: Free agents/waivers/trades, playoffs, notifications
- **P2**: Achievements/recap cards, league chat

---

## Implementation Status

### What's Built (P0 complete, P1 partial)
- **Auth**: JWT-based login/register (`/api/auth`). New passwords (signup + reset) must be 8+ chars with ≥1 number and ≥1 special character (`passwordPolicyError` in `routes/auth.ts`, mirrored client-side in `frontend/src/utils/passwordPolicy.ts`); login is deliberately not policed so pre-policy accounts keep working. E2e signup passwords must be compliant (`testpass123!`).
- **Password reset**: "Forgot password?" link on the login form → public pages `/forgot-password` and `/reset-password?token=`. `POST /api/auth/forgot-password` returns 404 for unknown emails (explicit product decision to reveal account existence) and otherwise emails a single-use 1-hour link via `sendEmail` **directly** — never through the Notification outbox. `PasswordResetToken` stores only a sha256 `tokenHash`; new requests invalidate a user's outstanding tokens (`usedAt`, not delete); `createPasswordResetToken()` is exported from `routes/auth.ts` and reused by the test-only `POST /api/test/reset-token` (e2e can't read the emailed token). `POST /api/auth/reset-password` swaps the bcrypt hash + burns the token in one `$transaction` and returns `{token, user}` (same shape as `/login` → auto-login). With no `RESEND_API_KEY` the route logs the reset URL server-side and still returns 200 (dev/e2e). `renderEmail` now takes optional `cta: {url,label}` / `footer` overrides (defaults unchanged for dispatcher emails). Existing 30-day JWTs are NOT revoked on reset.
- **Account deletion**: Danger Zone on `/account` → `DELETE /api/auth/me` with `{ password }` (bcrypt-verified; 403 on mismatch). Logic in `backend/src/account/deleteAccount.ts`, one `$transaction` (15s timeout): leagues the user commissions transfer to the earliest-joined other member with a live account (`transferCommissioner`), or are cascade-deleted when there's no heir; teams in `pending` leagues are deleted (leave-league semantics, `member_left` feed event); teams in started leagues are **kept** (matchups/draft/pick order reference them) and the User row is **soft-deleted** instead: `deletedAt` set, email/username scrubbed to `deleted-{id}@deleted.local` / `deleted_{cuid tail}`, `passwordHash: '!account-deleted'`, avatar removed, Notification + PasswordResetToken rows deleted, pending waiver claims cancelled, an unmanaged-team feed event per league. With no kept teams the User row is hard-deleted (notifications/reset tokens cascade). Guards: `requireAuth` is now **async** and 401s tokens of missing/soft-deleted users (PK select per request); login/`GET /me`/forgot-password/reset-password all treat `deletedAt` as nonexistent.
- **Commissioner transfer**: `POST /api/leagues/:id/transfer-commissioner { newCommissionerId }` — commissioner-only, allowed in **any** league status (not settings-locked), target must own a team and not be soft-deleted. Shared helper `transferCommissioner(db, league, user)` in `backend/src/leagues/transfer.ts` (accepts tx handle): league update + `commissioner_transfer` notification + `commissioner_transferred` feed event. UI: "Transfer Commissionership" card in the League Hub Settings tab (member dropdown).
- **Leagues**: create (requires draft time ≥1 hr from now), join via invite code/link or public list, settings, commissioner delete with member notifications
- **Kicking members**: `POST /leagues/:id/teams/:teamId/kick` (commissioner-only, pre-draft only — `league.status === 'pending'`, same gate as `/leave`, since Team's `DraftPick`/`Matchup` relations don't cascade so a team with draft/matchup history can't be safely deleted). Deletes the team (RosterSpot cascades), sends the kicked user a `kicked_from_league` notification (`leagueId: null`, shows as a Home banner like `league_deleted`), and logs a `member_kicked` league event. UI: "Members" card in the League Hub Settings tab (pre-draft only), per-row Remove button with two-step confirm, same pattern as Delete League/Leave League.
- **Public leagues**: listed on the join page (`GET /leagues/public`); anyone can join an open public league
- **Sharing an invite**: `ShareInviteButton` (`frontend/src/components/ShareInviteButton.tsx`), used on the League Hub Settings Invite card and the League Create success screen. Calls `navigator.share({title, text, url})` when available (native OS share sheet); otherwise opens a fallback popup with Messages/WhatsApp/Email deep-links (`sms:`, `wa.me`, `mailto:`) plus a Copy Link button. No backend changes — same invite URL/code as before.
- **Invite-link redirect through signup**: an unauthenticated visit to any `ProtectedRoute` (e.g. `/leagues/join/:code`) now round-trips through `/auth?redirect=<path>` — `RequireAuth`/`RequireOnboarded` in `App.tsx` encode the attempted path, `Auth.tsx` forwards it (`/onboarding?redirect=...` on signup since new accounts must onboard first, straight to `redirect` on login), and `Onboarding.tsx` reads it and navigates there on completion instead of hardcoding `/home`. So clicking an invite link, signing up, and finishing onboarding lands the user back on the invite page automatically — no second click on the link.
- **Artist database**: genre-tagged, real-chart artists from Apple Music; weekly scores populated by daily pipeline; searchable/filterable
- **Draft**: live snake draft via socket.io; 10-min pre-draft lobby (`pre_draft` status) with `CountdownRing`; 60s per-pick timer with `TimerRing`; commissioner can skip countdown; auto-draft on pick expiry; scheduled auto-start at `league.draftTime`
- **Roster/lineup**: starter↔bench swap (My Team tab); slot-legality enforced; lineup locked Tuesday–Sunday (with week-1 pre-game exception); `PUT /roster/lineup` returns 403 when locked
- **Matchups & standings**: head-to-head, weekly scores, standings with playoff cutline. "Around the League" rows (every matchup in the viewed week) expand on click to show both teams' full rosters with that week's per-artist scores, via `GET /leagues/:id/matchups/:matchupId` (member-only; fetched on expand; upcoming-week rows don't expand — no scores yet)
- **Matchup lifecycle**: three phases — `pre_season` (empty), `adjustment` (Monday: open lineup, prev scores in gray, win/loss popup), `scoring` (Tue–Sun: locked, live scores)
- **Scoring**: real Apple Music chart data via daily pipeline; `songPositionPoints + songMovementPoints + albumPositionPoints + albumMovementPoints + longevityPoints = totalPoints`
- **Artist detail**: chart breakdown (song position, song movement, album position, album movement, longevity) as score bars; back button returns to previous page
- **Player lists**: all lists show Name, Genre, Picture, Last Week score, 5W Avg; sortable by clicking headers. `avgLast5Points` always divides by a fixed 5 (`leagues.ts` `/players`, `artists.ts`, `trades.ts` `artistWithStats`) — weeks with no `WeeklyScore` row (artist not yet tracked/charted) count as zero rather than being excluded from the average, so a hot single week doesn't inflate a newcomer's average the way dividing by the row count found did.
- **Notifications**: DB-backed. Two layers: user-scoped `Notification` rows (trade lifecycle, lineup reminders, league deletion — `leagueId` column scopes them to a league's feed; league-deletion rows keep it null and show as Home banners) and league-wide `LeagueEvent` rows (claims, member joins, trade accepted/executed/vetoed, weekly `week_result` recaps, `playoffs_set`, `season_complete`, `draft_complete`). Emitted via `logLeagueEvent(db, leagueId, type, message, meta?)` in `src/events/leagueEvents.ts` — pass the tx handle at transactional sites. `GET /leagues/:id/activity` (member-only) returns the merged feed (newest-first, cap 100) + `unseenCount`; `POST /leagues/:id/notifications/seen` bulk-marks the user's league-scoped rows seen. Feed events from the finalize pipeline are guarded by its idempotency gates (`count > 0` checks) so re-runs never duplicate them.
- **Email (Resend, outbox pattern)**: every personal `Notification` row is also emailed. Writes stay untouched (many run inside transactions with only `userId` in scope); instead `Notification.emailedAt DateTime?` is the outbox gate and `startEmailDispatcher()` (`src/email/dispatcher.ts`, started from `server.ts` like the pipeline scheduler) ticks every 30s: retire rows older than 24h unsent (stale-flood/poison valve), then send up to 10 oldest-first via `src/email/mailer.ts` (Resend REST, native fetch) with subjects/layout from `src/email/templates.ts` (HTML-escapes user-controlled names). Sent or **permanent** failure (non-429 4xx, e.g. unverified-domain 403) → `emailedAt` set; transient (429/5xx/network) → retried next tick. Idempotent with finalize re-runs for free (`emailedAt` is the single send gate). Env: `RESEND_API_KEY` (dispatcher no-ops without it, also under `NODE_ENV=test`/`EMAIL_DISPATCH_DISABLED`), `EMAIL_FROM` (default `Bandwagon <onboarding@resend.dev>`). `sendEmail` itself also returns `skipped` under `NODE_ENV=test` — e2e boots the real server with a real `.env`, and must never send actual mail. **Free-tier Resend without a verified domain only delivers to the account owner's address** — other recipients 403 → logged + retired, harmless. The migration backfills `emailedAt` on all pre-existing rows so first deploy sends nothing stale.
- **Welcome email**: `POST /auth/signup` creates a `welcome`-type `Notification` right after the user row (`routes/auth.ts`), so it rides the same outbox dispatcher as every other personal notification — no direct `sendEmail` call needed. Sent within ~30s of signup, before onboarding in most cases (greeting falls back to "Hi there," since `username` is still null at that point).
- **Notifications tab (League Hub)**: merged activity feed with unseen-count badge on the tab; personal items highlighted with a "For you" badge; opening the tab auto-marks notifications seen. The root LeagueHub component polls `GET /activity` every 45s (query key `['activity', id]`, shared with the tab via the react-query cache).
- **Waivers**: free agents are claimed via waiver — except while the lineup is adjustable (Monday / week-1 pre-game window, the same `isLineupLocked` rule), when `POST /roster/claim` executes the pickup **instantly and free** (no queue, no waiver-order demotion; feed event type `claim`). E2e note: `.env.test` pins `TEST_OVERRIDE_DAY=Tuesday` so claims queue; specs needing the adjustable-lineup state use `setupActiveLeague({ draftDaysAgo: 0 })` (week-1 window works on any real day). Otherwise `POST /leagues/:id/roster/claim` queues a `WaiverClaim` (with a `dropArtistId` snapshot of the slot occupant; stale snapshots invalidate at resolution). Claims resolve during the weekly finalize (Sunday night = Monday ~00:01 PT), **after** trades execute: `resolveWaivers()` in `src/waivers/engine.ts` processes claims in waiver-order (waiverPriority asc, team createdAt tiebreak), each win in its own guarded `$transaction` (pending→won flip is the gate; validation failure throws → rollback → pending→invalid). Conflicts on the same artist go to the higher-priority team ("lost" + notification for the rest); each winner moves to the bottom of the order **mid-resolution**, with the dense 1..N order persisted inside the win tx (crash-safe). Initial order = reverse draft order, seeded in `makePick`'s completion branch. Within a team, claims resolve by the user-set per-claim `priority` (1 = attempted first; new claims append to the back; `PUT /leagues/:id/waivers/order` rewrites the full order). Endpoints: `GET /leagues/:id/waivers` (my pending claims in priority order + waiver position), `POST /leagues/:id/waivers/:claimId/cancel`. UI: shared `WaiverClaimsCard` (up/down reorder arrows + cancel) rendered on both the My Team and Players tabs; "Claimed" pill on Players rows; Standings shows a Waiver column. Feed: `waiver_won` LeagueEvent + `waiver_result` personal notifications.
- **Trades**: proposed on a dedicated page (`/leagues/:id/trade`, not a LeagueHub tab) with clickable team cards, dual roster columns showing Last/5W-avg stats, artist-name links to profiles, and a sessionStorage draft (`bw_trade_draft_{leagueId}`) that survives detours to artist pages. Entry points: My Team → Trades "Propose Trade" button, the trade icon on rostered players in the Players tab, and a Trade button on artist profiles (all pass `?artistId=`; the page derives the owning team). Receiver accepts/rejects; proposer can cancel while pending. My Team's team name is also a dropdown that browses every league team's roster read-only (`teams-with-rosters` now includes current-week scores). Uneven trades require the net-gaining side to designate drops (proposer at propose time, acceptor at accept time). Accepted trades execute at the weekly finalize (Monday ~00:01 PT = EOD Sunday); their artists are locked from claims/other trades until then. Any non-involved member can veto an accepted trade; it dies only on a **unanimous** veto (all `teamCount − 2` others). Trade deadline: end of week 7 (pending proposals are cancelled at that finalize). Resolved trades (rejected/vetoed/cancelled/executed/failed) stay in the Trades section only for the rest of the PT day they resolved (`tradeVisibleToday` filter in `GET /leagues/:id/trades`); the activity feed keeps the permanent record. Slot legality is validated with a seeded bipartite matcher (`assignRoster`) at propose/accept/execute — a trade that would strand a genre slot with no eligible player is rejected. Models: `Trade`/`TradeItem` (drops = `toTeamId: null`)/`TradeVeto`; engine in `backend/src/trades/engine.ts`, routes in `api/routes/trades.ts` (third router mounted at `/api/leagues`).
- **Season rollover**: once `league.status = 'complete'`, LeagueHub shows a champion banner (`SeasonCompleteBanner`); the commissioner can renew via `POST /leagues/:id/renew { draftTime }` (ISO, ≥1 hr out). `renewLeague()` in `src/season/rollover.ts` wipes season data in one transaction (matchups, draft picks/state, waiver claims, trades; roster spots emptied), resets team records, sets `draftPosition`/`waiverPriority` to **reverse final standings** (worst team drafts first), bumps `seasonYear`, and returns the league to `pending` with the new draft time — the draft scheduler takes over from there. Teams, members, and the feed history survive; a `league_renewed` feed event + notifications go out.
- **Playoffs**: after week 10, top 4 seeds play a bracket (week 11 semifinals 1v4/2v3; week 12 Championship + 3rd Place Game) and seeds 5–8 a consolation bracket (5v8/6v7 → 5th/7th Place Games). Pairing logic in `backend/src/playoffs/bracket.ts`, driven by `finalizePipeline.ts`. Playoff games have `matchup.matchupType` (`semifinal`/`championship`/`third_place`/`consolation_semifinal`/`fifth_place`/`seventh_place`) + `homeSeed`/`awaySeed`; they never touch wins/losses/pointsFor (standings freeze after week 10); dead ties go to the higher seed. Bracket adapts to 4–12 teams (<4: no playoffs). After week 12 finalizes, `league.status = 'complete'`. `GET /leagues/:id/bracket` returns the real bracket once week-11 matchups exist, else a projection from current standings (`projected: true`); the Standings tab renders it, and the Matchup tab's week label opens a week-picker dropdown.

### Directory Layout
```
bandwagon/
  backend/
    prisma/
      schema.prisma       # DB schema
      seed.ts             # Local dev seed (mock artists + scores); NOT used in production
      migrations/
    src/
      server.ts           # Express + socket.io entry point; calls startDraftScheduler(io)
      db/prisma.ts        # Shared PrismaClient singleton
      api/
        middleware/
          auth.ts         # JWT signing + requireAuth middleware
          errorHandler.ts
        routes/
          auth.ts
          leagues.ts      # League CRUD, standings, matchups, /players, lineup swap, /public
          artists.ts
          draft.ts        # Draft lifecycle + makePick() (also used by sockets/draft.ts)
          notifications.ts
      data/
        provider.ts       # DataProvider interface (data-access-layer abstraction)
        mock.ts           # MockDataProvider — used only in local dev/seed
      scoring/
        tiers.ts          # Pure scoring functions (chart position/movement/longevity tiers)
        engine.ts         # scoreArtistWeekFromCharts() / updateMatchupScores() orchestration
      season/rollover.ts  # renewLeague(): season reset + reverse-standings draft order
      email/
        mailer.ts         # Resend REST client (sendEmail — never throws)
        templates.ts      # per-notification-type subjects + shared HTML layout
        dispatcher.ts     # 30s outbox loop over Notification.emailedAt
      sockets/draft.ts    # Live draft socket handler; pre-draft countdown + per-pick timers
      jobs/
        dailyPipeline.ts  # Ingests Apple Music charts → scores all artists → updates matchups
        finalizePipeline.ts # Finalizes week, sets winnerId, advances currentWeek
        resetLeagues.ts   # Admin script: deletes the demo leagues (by invite code) and rebuilds them with real-chart artists; user-created leagues untouched
  frontend/
    src/
      pages/
        Auth.tsx
        Home.tsx          # Shows leagues + dismissible notifications
        LeagueHub.tsx     # Tabs: My Team (default), Matchup, Standings, Players, Notifications, Settings
        DraftRoom.tsx     # Live draft room; CountdownRing (pre_draft) + TimerRing (drafting)
        LeagueCreate.tsx  # League creation form; draft time required (≥1 hr)
        LeagueJoin.tsx    # Invite code entry + public league browser
        ArtistDetail.tsx  # Score breakdown bars; back button uses navigate(-1)
      context/AuthContext.tsx
      api/
        client.ts         # fetch wrapper
        types.ts          # shared TS interfaces
      components/ui/      # Card, Badge, Avatar, Button, Input, Spinner
  railway.toml            # Railway deployment config (build + start commands, healthcheck)
```

## Backend Architecture Notes

- **Scoring pipeline**: `jobs/dailyPipeline.ts` fetches the Apple Music Most Played Songs (Top 100) and Albums (Top 100) RSS feeds, ingests them into `ChartEntry` / `AlbumChartEntry` tables, enriches artist genres via iTunes Lookup, then calls `scoreAllArtistsForWeek(weekDate)`. `scoring/engine.ts`'s `scoreArtistWeekFromCharts()` reads chart positions directly from the DB — no external provider call at score time.
- **WeeklyScore is keyed by calendar `weekDate`** (the chart week's Tuesday, same value as `ChartEntry.weekDate`; unique `[artistId, weekDate]`) — NEVER by league week number. League weeks are per-league counters: two leagues that started on different dates give the same number to different calendar weeks, and week-number keying let them overwrite each other's history (2026-07-14 incident). Reads translate with `weekDateForLeagueWeek(currentWeek, week)` in `scoring/engine.ts` (anchored on `getCurrentWeekDate()`, matching how the daily pipeline writes); the league's current week is always `getCurrentWeekDate()` itself. The artist-detail page computes from chart entries directly, so it agrees with stored rows by construction. `jobs/repairLeagueWeeks.ts` is the one-off incident repair (rolls back skipped league weeks + rebuilds the WeeklyScore cache; the table is a pure cache and safe to rebuild from chart data).
- **Multi-artist credits are split**: joint credits ("A, B & C") never become their own Artist row. `splitArtistCredit()` in `src/data/artistCredits.ts` splits on `" & "` (then `", "`, re-attaching generational suffixes like "Jr."); names without `" & "` and the curated `NO_SPLIT` set of permanent acts (Zion & Lennox, Earth, Wind & Fire, …) stay whole — when the ingest `[split]` log shows a real single act being split, add it to `NO_SPLIT` and hand-merge. Ingest (`resolveCreditedArtists` in `ingestCharts.ts`) upserts each component **by exact name only** (the feed's `artistId` belongs to the combined credit and is never attached; `genreEnrichedAt` stays null so the genre backfill re-resolves by name search) and writes **one ChartEntry/AlbumChartEntry per credited artist** — the uniques are `@@unique([weekDate, chart, rank, artistId])` and each ingest pass `deleteMany`s rows at the rank whose artist is no longer credited. Every component gets FULL points for the shared song (by design). Movement lookups in `scoring/engine.ts` and `routes/artists.ts` are therefore `artistId`-scoped — keep any future `appleSongId`/`appleAlbumId` join scoped too.
- **Hidden artists**: `Artist.hiddenAt` retires a row (combined credits split by `src/jobs/splitCombinedArtists.ts`) while keeping WeeklyScore/DraftPick/TradeItem history intact. Hidden rows are excluded from `GET /artists`, `GET /leagues/:id/players`, auto-draft pools, `makePick`, waiver claims, `resetLeagues`, and `scoreAllArtistsForWeek`; `GET /artists/:id` still serves them. The split script (idempotent, `--dry-run` supported, run manually: `DATABASE_URL=<url> npx tsx src/jobs/splitCombinedArtists.ts`) also duplicates the combined row's chart entries per component, re-points roster spots to the first-listed available component via `assignRoster` (all taken → spot emptied), invalidates pending waiver claims and open trades touching it, emits `artist_split` feed events, re-scores components for all league weeks, and refreshes current matchups.
- **Finalization**: `jobs/finalizePipeline.ts` runs Monday ~00:01 PT. It sets `matchup.isFinalized = true`, resolves ties (highest single artist score among starters), sets `matchup.winnerId`, and advances `league.currentWeek`. **Once-per-PT-date guard**: `League.lastFinalizedDatePT` (set after each league's successful finalize) makes `runFinalizePipeline` skip leagues already finalized today — without it, every Monday deploy restarted the scheduler and re-finalized the freshly advanced week, skipping whole weeks (bug of 2026-07-13). `--force` (CLI) bypasses the guard for deliberate same-day re-runs; `finalizeLeagueWeek()` itself stays unguarded (e2e helpers advance many weeks per day). Within a week it is idempotent via the `isFinalized` gate.
- **Pipeline scheduler**: `startPipelineScheduler()` in `jobs/scheduler.ts` runs both pipelines automatically in-process (started from `server.ts`, same pattern as the draft scheduler). 60s tick; daily pipeline once per PT date at `DAILY_PIPELINE_TIME_PT` (default 06:00 PT); finalize Monday ≥00:01 PT (no catch-up on later days). Per-PT-date success dedupe, in-flight overlap guard, 15-min retry backoff on failure; on Mondays the daily run waits until finalize has succeeded (finalize advances `currentWeek` first). No-op under `NODE_ENV=test` or `PIPELINE_SCHEDULER_DISABLED=1`. Pipelines export `runDailyPipeline()` / `runFinalizePipeline()`; both files keep CLI behavior under `require.main === module` guards.
- **Scoring tiers**: `scoring/tiers.ts` holds pure, DB-free scoring functions. Song and album chart position use identical tiers. Longevity: `Math.min(Math.max(consecutiveWeeks - 1, 0) * 2, 10)`.
- **Lineup lock**: `PUT /leagues/:id/roster/lineup` enforces lock: returns 403 on Tuesday–Sunday (PT) unless `currentWeek === 1` and today is before the first Tuesday after `league.draftTime`. Both backend and `getWeekPhase()` in `LeagueHub.tsx` use the same day-of-week + date-string comparison logic.
- **Auth**: `api/middleware/auth.ts` exports `requireAuth` (HTTP) for Express routes. `sockets/draft.ts` verifies the JWT manually on every `draft:join`/`draft:pick`/`draft:skip-countdown` socket event — socket.io has no shared middleware chain with Express here.
- **Draft statuses**: `pending` → `pre_draft` → `drafting` → `active`/`complete`. `League.draftTime` stores the countdown-end timestamp during `pre_draft`. `League.status` is a plain String field — no migration needed to add new values.
- **Draft timers**: two in-memory Maps in `sockets/draft.ts`:
  - `countdownTimers: Map<leagueId, Timeout>` — fires once when the 10-min pre-draft countdown ends, calls `transitionToLiveDraft`
  - `leagueTimers: Map<leagueId, Interval>` — per-pick 60s countdown, calls `fireAutoDraft` on expiry
  - Neither is persisted. On server restart, `draft:join` reconnect restarts whichever timer is appropriate.
- **Draft scheduler**: `startDraftScheduler(io)` runs a `setInterval` every 30s in `server.ts`. It queries for `pending` leagues with `draftTime <= now` and calls `scheduledDraftStart(io, leagueId)` to auto-transition them to `pre_draft`.
- **Slot-eligibility logic is duplicated in three places** — keep them in sync if roster rules change: `api/routes/draft.ts` (`isEligible`, human picks), `sockets/draft.ts` (`isEligible`, auto-draft), and `api/routes/leagues.ts` (`artistEligibleForSlot`, starter↔bench swap + free-agent claims + the trades engine, which imports it). All encode "Other slot = primary genre not in R&B/Hip-Hop/Pop/Rock & Alternative/Country".
- **`trades/engine.ts` ↔ `routes/leagues.ts` import each other** (engine needs `artistEligibleForSlot`; leagues needs `lockedArtistIds` for the claim lock). Safe because both only reference the other's exports at call time — don't add module-init-time usage.
- **Route ordering**: `GET /leagues/public` **must** be registered before `GET /leagues/:id` in `leagues.ts`, and `GET /leagues/:id/matchups/previous` before `GET /leagues/:id/matchups/current`; the parameterized `GET /leagues/:id/matchups/:matchupId` must stay after both of those literals (Express matches in registration order).
- **Routing**: both `leagueRoutes` and `draftRoutes` are mounted at `/api/leagues` in `server.ts` — draft endpoints live under `/api/leagues/:id/draft*`.
- **datetime-local inputs** return strings without timezone (e.g. `"2026-06-18T10:00"`). Always convert to ISO before sending to the API: `new Date(value).toISOString()`. Zod's `.datetime()` rejects bare local strings.
- **`GET /artists` limit**: defaults to 40, max 500 via `?limit=N`. DraftRoom passes `limit=500` to show all artists.
- **Error tracking (Sentry)**: `Sentry.init()` (in `backend/src/instrument.ts`, imported first thing in `server.ts` right after `dotenv/config`) is gated on `SENTRY_DSN` being set and `NODE_ENV !== 'test'` — no DSN means the SDK never initializes, zero behavior change (same no-op pattern as `PIPELINE_SCHEDULER_DISABLED`/`EMAIL_DISPATCH_DISABLED`). `Sentry.setupExpressErrorHandler(app)` sits between `notFound` and `errorHandler` in the middleware chain, filtered by `shouldReportToSentry()` (exported from `api/middleware/errorHandler.ts`) so expected 400s (`ZodError`, `multer.MulterError`) never get reported — only real unexpected errors. `errorHandler.ts` itself does **not** call `Sentry.captureException` — `setupExpressErrorHandler` already captures upstream in the chain; adding it there too would double-report. Uncaught exceptions/unhandled rejections need no extra `process.on(...)` handlers — both are captured by Sentry's default integrations once `Sentry.init()` runs. Frontend mirrors this: `frontend/src/lib/sentry.ts`'s `initSentry()` (called first thing in `main.tsx`) is gated on `VITE_SENTRY_DSN` + non-test Vite `MODE`; `<Sentry.ErrorBoundary>` wraps the whole app tree in `main.tsx` unconditionally (real UX fallback — avoids a blank screen on a render error — even with no DSN configured). No source-map/release upload pipeline yet, so Sentry stack traces are minified until that's added as a fast-follow. Env: `SENTRY_DSN`/`SENTRY_ENVIRONMENT` (backend), `VITE_SENTRY_DSN`/`VITE_SENTRY_ENVIRONMENT` (frontend, baked in at Vite **build** time — must be present in Railway's build env, not just deploy env, since this is one service where the frontend build runs before the backend build in `npm run build`).

## Socket Events (draft)

| Event | Direction | Description |
|-------|-----------|-------------|
| `draft:join` | client→server | Join room, receive current state |
| `draft:state` | server→client | Full state snapshot (status, picks, teams, timers) |
| `draft:tick` | server→client | Per-second countdown for current pick |
| `draft:pick` | client→server | Make a pick |
| `draft:pick-made` | server→client | Pick confirmed, broadcast to room |
| `draft:skip-countdown` | client→server | Commissioner skips pre-draft lobby |
| `draft:complete` | server→client | Draft finished |
| `draft:error` | server→client | Error message |

`draft:state` payload includes `countdownEndsAt` (ISO string or null) during `pre_draft`. Clients calculate remaining seconds locally from this timestamp.

## Commands

```bash
# Install everything (root + backend + frontend)
npm run setup

# Run backend + frontend together — must run from bandwagon/ not repo root
cd bandwagon && npm run dev

# Or individually:
cd bandwagon/backend && npm run dev     # tsx watch, port 3001
cd bandwagon/frontend && npm run dev    # Vite, port 5173 (auto-increments if taken)

# DB: migrate / seed / inspect
cd bandwagon && npm run db:migrate
cd bandwagon && npm run db:seed        # Local dev only — populates mock data
cd bandwagon && npm run db:studio

# Run scoring pipelines manually (against production DB, use DATABASE_PUBLIC_URL).
# Production runs both automatically via the in-process scheduler (jobs/scheduler.ts);
# manual runs remain safe — the daily pipeline is idempotent and finalize is guarded per PT date (pass --force to re-run finalize the same day).
cd bandwagon/backend && npm run pipeline:daily
cd bandwagon/backend && npm run pipeline:finalize

# Reset demo leagues on production (deletes only CHART-2026/PUBLIC-2026, rebuilds with real-chart artists)
cd bandwagon/backend && DATABASE_URL="<prod-url>" npx tsx src/jobs/resetLeagues.ts

# Typecheck / build
cd bandwagon/backend && npm run build   # tsc
cd bandwagon/frontend && npm run build  # tsc && vite build

# Tests
cd bandwagon/backend && npm test        # vitest unit tests
cd bandwagon/frontend && npm test       # vitest unit tests
cd bandwagon && npm run test:e2e        # Playwright (needs .env.test + bandwagon_test DB)

# Deploy to Railway
cd bandwagon && railway up
```

**Demo accounts** (both use `password123`):
- `demo1@bandwagon.app` — MusicMaven (commissioner of demo league + public league)
- `demo2@bandwagon.app` — ChartWatcher
- `demo3@bandwagon.app` — BeatBroker
- `demo4@bandwagon.app` — HookHunter

**Production demo leagues** (created by `resetLeagues.ts`, NOT seed.ts):
- `CHART-2026` — "Chart Toppers 2026", private, `active`, week 3, 4 demo teams, real-chart artists (for testing roster/matchup/standings/playoff bracket)
- `PUBLIC-2026` — "Open Draft 2026", public, `pending`, 8-team cap, 1 member (for testing join flow)

## Key Implementation Notes

- **`npm run dev` must be run from `bandwagon/`**, not the repo root. The repo root has no `package.json`.
- **Kill old backend before restarting**: `lsof -ti :3001 | xargs kill -9`
- **Frontend dev port**: Vite is configured for 5173 but auto-increments to 5174 if 5173 is taken. The `/api` and `/socket.io` proxy works regardless of which port Vite lands on.
- **DraftRoom socket state** does not include `rosterSpots`. Derive filled slots from `state.picks.filter(p => p.teamId === myTeam.id).map(p => p.slot)`.
- **Production DB**: internal URL (`postgres.railway.internal`) only works inside Railway network. Use `DATABASE_PUBLIC_URL` for local admin scripts.
- **League deletion** cascades via Prisma to teams, roster spots, picks, and draft state. Members receive a `Notification` record (type: `league_deleted`) shown as a dismissible banner on Home.
- **LeagueHub polls** the league query every 5s while `status === 'pending'` or `'pre_draft'` so all members see the "Go to Draft" button appear in real time.
- **Matchup week phase** (`getWeekPhase` in `LeagueHub.tsx`): `pre_season` if not active; `adjustment` if Monday or (week 1 and before first Tuesday after draftTime); `scoring` otherwise. Both frontend and backend use Pacific timezone day-of-week checks.
- **Win/loss popup** appears once per week on Monday in the Matchup tab, gated by `localStorage` key `bw_result_${leagueId}_w${week}`.
- **Sentry DSNs are not yet provisioned** — `SENTRY_DSN`/`VITE_SENTRY_DSN` are unset in Railway today, so error tracking is fully wired but inert. To activate: sign up at sentry.io, create backend (Node) and frontend (React) projects (or one combined project), add `SENTRY_DSN` and `VITE_SENTRY_DSN` to the Railway service's variables, redeploy. `sendDefaultPii` is deliberately left at its default `false` — the app puts JWTs in `Authorization` headers on every request, and enabling it would start shipping bearer tokens to Sentry.
