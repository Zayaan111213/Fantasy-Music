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
- **Roster/lineup**: starter↔bench swap, slot-legality enforced
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
    src/
      server.ts           # Express + socket.io entry point
      api/routes/
        auth.ts
        leagues.ts        # includes /players endpoint
        artists.ts
        draft.ts
        notifications.ts
      sockets/draft.ts    # Live draft socket handler
  frontend/
    src/
      pages/
        Auth.tsx
        Home.tsx           # Shows leagues + dismissible notifications
        LeagueHub.tsx      # Tabs: Matchup, Standings, Players, Settings
        DraftRoom.tsx      # Live draft room with artist pool
        LeagueCreate.tsx
        LeagueJoin.tsx
        ArtistDetail.tsx
      api/
        client.ts          # fetch wrapper
        types.ts           # shared TS interfaces
      components/ui/       # Card, Badge, Avatar, Button, Spinner
```

## Running Locally

```bash
# Backend (port 3001) — uses tsx watch, restart picks up code changes automatically
cd bandwagon/backend && npm run dev

# Frontend (port 5174 — Vite auto-selected this; 5173 is a different app on this machine)
cd bandwagon/frontend && npm run dev

# Seed database (required for weekly score data and demo league)
cd bandwagon/backend && npx prisma db seed
```

**Demo accounts** (created by seed, both use `password123`):
- `demo1@bandwagon.app` — MusicMaven
- `demo2@bandwagon.app` — ChartWatcher

## Key Implementation Notes

- **Frontend port is 5174**, not the Vite default 5173. The Vite proxy (`/api`, `/socket.io` → port 3001) works on 5174.
- **DraftRoom socket state** does not include `rosterSpots`. Derive a team's filled slots from `state.picks.filter(p => p.teamId === myTeam.id).map(p => p.slot)` — do not access `myTeam.rosterSpots`.
- **Weekly score data** only exists after running the seed. Without it, all score columns show `0.0`.
- **Backend must be running** for the `/api/health` check and all data. Kill old process with `lsof -ti :3001 | xargs kill -9` before restarting.
- **League deletion** cascades via Prisma to teams, roster spots, picks, and draft state. Members receive a `Notification` record (type: `league_deleted`) shown as a dismissible banner on Home.
