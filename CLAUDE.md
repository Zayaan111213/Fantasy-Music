# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Bandwagon** is a fantasy sports app for music. Users draft rosters of real recording artists and earn points each week based on real-world performance: streaming volume, chart position, and chart movement. Friends compete head-to-head in private leagues. Full spec is in `PRD.md`.

## Tech Stack

- **Backend**: Node.js with TypeScript
- **Frontend**: React
- **Database**: PostgreSQL (relational — strongly recommended over alternatives given the data model)

PostgreSQL is the right fit because the domain is deeply relational: users → leagues → teams → rosters → artists → weekly scores → matchups. The app relies on multi-table JOINs (standings, scoring rollups), transactions (roster adds must atomically drop another artist), and DB-level constraints as a safety net for slot-legality. Postgres window functions also simplify ranking and tier-table lookups in the scoring pipeline.

## Architecture Requirements (from PRD)

### Data Access Layer (mandatory abstraction)
The app **must not** call data providers (Luminate, Billboard) directly from feature code. All external data must go through an internal data-access layer that exposes methods like `getWeeklyStreams(artist, week)`. This is a hard requirement — it enables provider swaps, fallbacks, and graceful degradation. If a source drops for a week, scoring must continue on available signals and flag the gap, never hard-fail the whole run.

### Scoring Engine
An artist's weekly score = streaming volume points + chart position points + chart movement points. Each signal has its own tier table (see §9 of PRD). Streaming tiers are **per-genre** to normalize smaller genres (country, Latin) against larger ones (hip-hop, pop) — store one threshold table per genre. Week boundaries align to Billboard/Luminate tracking week: Friday 00:00 – Thursday 23:59 US time.

### Roster & Eligibility
9-artist rosters: 6 starters (Hip-Hop, Pop, Rock, Country, Niche, Flex slots) + 3 bench. Eligibility checks run at draft, on every add/drop, and on every trade. Multi-genre artists are classified by **primary genre only**. Any action leaving a roster slot-illegal must be rejected with a clear message.

### Draft
Live snake draft with a per-pick clock (default 60s). Auto-draft on expiry selects the best available eligible artist for an open slot based on most recent week's points. Draft ends when every team fills all 9 slots.

### Season Structure
10-week regular season → round-robin head-to-head matchups → top 4 playoff (P1). Scores update on a daily provisional batch and finalize after each week closes.

### League Types
- **Private leagues**: invite-link only, commissioner-controlled settings
- **Public managed leagues**: system-created, auto-fill until full, auto-schedule draft (cold-start mitigation for friendless users)

### Key Domain Rules
- Lineup lock occurs at the **start** of the scoring week; no changes affect the current week's score after lock
- Waivers use rolling priority (claiming drops you to the bottom); adds require a corresponding drop
- Trades must leave both rosters slot-legal; legality check is required before acceptance
- Commissioner settings lock after the season starts (with narrow exceptions)
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
- **Leagues**: create, join (invite code/link), settings, commissioner delete with member notifications
- **Artist database**: genre-tagged, weekly scores seeded for 10 weeks, searchable/filterable
- **Draft**: live snake draft via socket.io, 60s timer, auto-draft on expiry, slot selector UI
- **Roster/lineup**: starter↔bench swap (My Team tab, the default tab), slot-legality enforced; Matchup tab is read-only (both rosters' scores side by side)
- **Matchups & standings**: head-to-head, weekly scores, standings with playoff cutline
- **Scoring**: seeded mock data; `streamingPoints + chartPositionPoints + chartMovementPoints = totalPoints`
- **Player lists**: all lists show Name, Genre, Picture, Last Week score, 5W Avg; sortable by clicking headers (first click = high→low, second = low→high)
- **Notifications**: DB-backed; currently used for league-deletion alerts shown on Home on next login

### Directory Layout
```
bandwagon/
  backend/
    prisma/
      schema.prisma       # DB schema
      seed.ts             # Mock data (artists, weekly scores, demo league)
      migrations/
    src/
      server.ts           # Express + socket.io entry point
      db/prisma.ts         # Shared PrismaClient singleton
      api/
        middleware/
          auth.ts          # JWT signing + requireAuth middleware
          errorHandler.ts
        routes/
          auth.ts
          leagues.ts        # League CRUD, standings, matchups, /players, lineup swap
          artists.ts
          draft.ts          # Draft lifecycle + makePick() (also used by sockets/draft.ts)
          notifications.ts
      data/
        provider.ts         # DataProvider interface (data-access-layer abstraction)
        mock.ts             # MockDataProvider — only implementation today, seeded-random
      scoring/
        tiers.ts            # Pure scoring functions (chart position/movement/streaming tiers)
        engine.ts           # scoreArtistWeek() / updateMatchupScores() orchestration
      sockets/draft.ts      # Live draft socket handler + in-memory per-pick timers
  frontend/
    src/
      pages/
        Auth.tsx
        Home.tsx           # Shows leagues + dismissible notifications
        LeagueHub.tsx      # Tabs: My Team (default, lineup editing), Matchup (read-only), Standings, Players, Settings
        DraftRoom.tsx      # Live draft room with artist pool
        LeagueCreate.tsx
        LeagueJoin.tsx
        ArtistDetail.tsx
      context/AuthContext.tsx
      api/
        client.ts          # fetch wrapper
        types.ts           # shared TS interfaces
      components/ui/       # Card, Badge, Avatar, Button, Input, Spinner
```

## Backend Architecture Notes

- **Data access layer**: `data/provider.ts` defines the `DataProvider` interface (`getWeeklyStreams`, `getBestChartPosition`, `getChartMovement`). `data/mock.ts`'s `MockDataProvider` is the only implementation today — it's deterministic per `artistId`/week via a seeded hash, not random per run. `scoring/engine.ts` is the only consumer; swapping in a real Luminate/Billboard provider means implementing the interface and passing it into `scoreArtistWeek`, no call-site changes elsewhere.
- **Scoring engine**: `scoring/tiers.ts` holds pure, DB-free scoring functions. `scoring/engine.ts`'s `scoreArtistWeek` loads the genre's `GenreStreamingTier` rows, **falls back to `'Pop'` tiers if the artist's genre has none seeded**, then upserts a `WeeklyScore`. Any signal the provider returns `null` for is recorded in `WeeklyScore.dataMissing` (comma-joined) rather than failing the run — this is the PRD's "never hard-fail on a missing signal" requirement in practice.
- **Auth**: `api/middleware/auth.ts` exports `requireAuth` (HTTP) for Express routes. `sockets/draft.ts` does **not** reuse that middleware — it verifies the JWT manually on every `draft:join`/`draft:pick` socket event because socket.io has no shared middleware chain with Express here.
- **Draft concurrency**: per-pick countdown timers live in an in-memory `Map<leagueId, Interval>` inside `sockets/draft.ts` (`leagueTimers`) — they are not persisted. Restarting the backend mid-draft drops the running interval; the draft's logical state (`DraftState.currentPick`/`timerEndsAt`) survives in Postgres, but a client reconnect (`draft:join`) is what actually restarts the timer.
- **Slot-eligibility logic is duplicated in three places** — keep them in sync if roster rules change: `api/routes/draft.ts` (`isEligible`, human picks), `sockets/draft.ts` (`isEligible`, auto-draft), and `api/routes/leagues.ts` (`artistEligibleForSlot`, starter↔bench lineup swap). All three encode "Niche = primary genre not in Hip-Hop/Pop/Rock/Country".
- **Routing**: both `leagueRoutes` and `draftRoutes` are mounted at `/api/leagues` in `server.ts` — draft endpoints live under `/api/leagues/:id/draft*`, not a separate `/api/draft` prefix.

## Commands

```bash
# Install everything (root + backend + frontend)
npm run setup

# Run backend + frontend together from repo root
npm run dev

# Or individually:
cd bandwagon/backend && npm run dev     # tsx watch, port 3001, restart picks up code changes
cd bandwagon/frontend && npm run dev    # Vite, port 5174 (see note below)

# DB: migrate / seed / inspect (runnable from repo root or bandwagon/backend)
npm run db:migrate
npm run db:seed
npm run db:studio

# Typecheck / build (no test suite or lint config exists in this repo yet)
cd bandwagon/backend && npm run build   # tsc
cd bandwagon/frontend && npm run build  # tsc && vite build
```

**Demo accounts** (created by seed, both use `password123`):
- `demo1@bandwagon.app` — MusicMaven
- `demo2@bandwagon.app` — ChartWatcher

## Key Implementation Notes

- **Frontend dev port is 5174**, not the Vite-configured default of 5173 (`vite.config.ts` sets `server.port: 5173`). Vite auto-increments when 5173 is taken by another process on this machine; the proxy (`/api`, `/socket.io` → port 3001) works the same regardless of which port Vite lands on.
- **DraftRoom socket state** does not include `rosterSpots`. Derive a team's filled slots from `state.picks.filter(p => p.teamId === myTeam.id).map(p => p.slot)` — do not access `myTeam.rosterSpots`.
- **Weekly score data** only exists after running the seed. Without it, all score columns show `0.0`.
- **Backend must be running** for the `/api/health` check and all data. Kill old process with `lsof -ti :3001 | xargs kill -9` before restarting.
- **League deletion** cascades via Prisma to teams, roster spots, picks, and draft state. Members receive a `Notification` record (type: `league_deleted`) shown as a dismissible banner on Home.
