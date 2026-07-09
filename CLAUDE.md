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

**Chart movement:** new entry/debut = +10; +1 per position gained (cap +15); −1 per position lost (cap −10).

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
- Waivers use rolling priority (claiming drops you to the bottom); adds require a corresponding drop
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
- **Auth**: JWT-based login/register (`/api/auth`)
- **Leagues**: create (requires draft time ≥1 hr from now), join via invite code/link or public list, settings, commissioner delete with member notifications
- **Public leagues**: listed on the join page (`GET /leagues/public`); anyone can join an open public league
- **Artist database**: genre-tagged, real-chart artists from Apple Music; weekly scores populated by daily pipeline; searchable/filterable
- **Draft**: live snake draft via socket.io; 10-min pre-draft lobby (`pre_draft` status) with `CountdownRing`; 60s per-pick timer with `TimerRing`; commissioner can skip countdown; auto-draft on pick expiry; scheduled auto-start at `league.draftTime`
- **Roster/lineup**: starter↔bench swap (My Team tab); slot-legality enforced; lineup locked Tuesday–Sunday (with week-1 pre-game exception); `PUT /roster/lineup` returns 403 when locked
- **Matchups & standings**: head-to-head, weekly scores, standings with playoff cutline
- **Matchup lifecycle**: three phases — `pre_season` (empty), `adjustment` (Monday: open lineup, prev scores in gray, win/loss popup), `scoring` (Tue–Sun: locked, live scores)
- **Scoring**: real Apple Music chart data via daily pipeline; `songPositionPoints + songMovementPoints + albumPositionPoints + albumMovementPoints + longevityPoints = totalPoints`
- **Artist detail**: chart breakdown (song position, song movement, album position, album movement, longevity) as score bars; back button returns to previous page
- **Player lists**: all lists show Name, Genre, Picture, Last Week score, 5W Avg; sortable by clicking headers
- **Notifications**: DB-backed; currently used for league-deletion alerts shown on Home on next login
- **Free agent claims**: add/drop from Players tab with rolling waiver priority
- **Trades**: propose from My Team → Trades (or the trade icon on rostered players in the Players tab). Receiver accepts/rejects; proposer can cancel while pending. Uneven trades require the net-gaining side to designate drops (proposer at propose time, acceptor at accept time). Accepted trades execute at the weekly finalize (Monday ~00:01 PT = EOD Sunday); their artists are locked from claims/other trades until then. Any non-involved member can veto an accepted trade; it dies only on a **unanimous** veto (all `teamCount − 2` others). Trade deadline: end of week 7 (pending proposals are cancelled at that finalize). Slot legality is validated with a seeded bipartite matcher (`assignRoster`) at propose/accept/execute — a trade that would strand a genre slot with no eligible player is rejected. Models: `Trade`/`TradeItem` (drops = `toTeamId: null`)/`TradeVeto`; engine in `backend/src/trades/engine.ts`, routes in `api/routes/trades.ts` (third router mounted at `/api/leagues`).
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
        LeagueHub.tsx     # Tabs: My Team (default), Matchup, Standings, Players, Settings
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

- **Scoring pipeline**: `jobs/dailyPipeline.ts` fetches the Apple Music Most Played Songs (Top 100) and Albums (Top 100) RSS feeds, ingests them into `ChartEntry` / `AlbumChartEntry` tables, enriches artist genres via iTunes Lookup, then calls `scoreAllArtistsForWeek()`. `scoring/engine.ts`'s `scoreArtistWeekFromCharts()` reads chart positions directly from the DB — no external provider call at score time.
- **Finalization**: `jobs/finalizePipeline.ts` runs Monday ~00:01 PT. It sets `matchup.isFinalized = true`, resolves ties (highest single artist score among starters), sets `matchup.winnerId`, and advances `league.currentWeek`. Idempotent — safe to re-run.
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
- **Route ordering**: `GET /leagues/public` **must** be registered before `GET /leagues/:id` in `leagues.ts`, and `GET /leagues/:id/matchups/previous` before `GET /leagues/:id/matchups/current` (Express matches in registration order).
- **Routing**: both `leagueRoutes` and `draftRoutes` are mounted at `/api/leagues` in `server.ts` — draft endpoints live under `/api/leagues/:id/draft*`.
- **datetime-local inputs** return strings without timezone (e.g. `"2026-06-18T10:00"`). Always convert to ISO before sending to the API: `new Date(value).toISOString()`. Zod's `.datetime()` rejects bare local strings.
- **`GET /artists` limit**: defaults to 40, max 500 via `?limit=N`. DraftRoom passes `limit=500` to show all artists.

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

# Run scoring pipelines (against production DB, use DATABASE_PUBLIC_URL)
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
