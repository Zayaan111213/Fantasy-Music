# **Bandwagon — Product Requirements Document**

**Author:** Zayaan Rashid  
**Status:** Draft  
**Last Updated:** June 8, 2026  
**Stakeholders:** Father  
**Target Release:** August 24

---

## **1\. Overview / TL;DR**

Bandwagon is fantasy sports for music. Users draft a roster of real recording artists on their team, and then get points each week based on those artists' real-world performances: streams, chart movement, etc. Friends compete in head-to-head leagues over a season, turning being a music fan into a competitive social game, the way fantasy football makes the actual game more interesting. Music fans already argue about who's winning, and Bandwagon gives that argument a scoreboard.

## **2\. Problem statement**

Music fandom is passionate yet passive. People follow artists intensely, debate taste, and track releases, but there's no shared, competitive layer that actually rewards being knowledgeable or making good predictions. Fantasy sports proved that there is a large market for turning spectatorship into competition, fantasy football alone drives tens of millions of recurring weekly users.

No product has cracked this market for music. There are apps that have combined fantasy and music, but they are more oriented around trivia or friends voting on the best song; there is no widespread app that has real-time scoring on official streaming data. Why now: the data all exists, there is a large community for music tracking, and fantasy-gaming is getting larger by the year.

## **3\. Goals & success metrics**

**Goals**

* Music fans draft a roster of music artists, and manage and compete with these rosters week over week  
* Establish a reasonable automated scoring pipeline from third-party music data  
* Build a social/viral loop around private leagues with friends

## **4\. Non-goals / out of scope**

* Real-money gambling/Wagering  
  * App will be free-to-play  
* Music playback  
  * Link out to music

## **5\. Users & use cases**

**Primary user:** engaged music fan, 16-34, already follows charts/social media and has friends to compete with

* **As a** new user, **I want to** draft a team of artists **so that** I can prove to my friends I have better music taste than them.  
* **As a** league member, **I want to** set my lineup each week and see live scores **so that** I can have a reason to consistently check the top charts and what music is growing.  
* **As a** league commissioner, **I want to** invite friends and customize settings **so that** my group has its own private competition.  
* **As a** competitive user, **I want to** trade artists and pick up "free agents" who are heating up **so that** I can react to real-world momentum.

## **6\. Information architecture (screen map)**

The app is organized into these top-level destinations. Detailed per-screen specs are in §12.

1. Auth — sign up / log in.  
2. Home / Leagues list — all leagues the user is in  
   1. Option to create a league or join one  
3. League hub — for one league, with tabs:  
   1. Matchup (default) — this week's head-to-head & lineup adjuster  
   2. Standings — league table, records  
   3. Players — browse/search all artists; free agents  
   4. League settings — (commissioner only can edit)  
   5. Chat — league trash-talk feed  
4. Draft room — live snake draft (active only during a league's draft window).  
5. Artist detail — score breakdown, stats, genre, link out to listen.  
6. Notifications / activity feed.  
7. Profile / account settings.

## **7\. Requirements**

### **7.1 Accounts & onboarding (P0)**

* Sign up with email \+ password  
* Onboarding after first signup:  
1. Pick a display name \+ avatar  
2. Land on Home with two clear CTAs  
   1. Create a league and Join a league.  
* A user can belong to multiple leagues simultaneously; each league has an independent roster, lineup, and record.

### **7.2 Leagues (P0)**

* **Create league:** commissioner sets league name, number of teams (4–12 \[default 8\]), privacy (private/public), and draft date/time.  
* **Private league:** join only via invite link.  
* **Public "managed" league:** system-created leagues that any solo user can join with one tap, auto-filling until full, then auto-scheduling a draft. This is the cold-start mitigation \- a friendless user can always play.  
* **Commissioner powers:** edit league settings before the season starts, set the draft time, and remove a member before draft. After the season starts, settings lock except where noted.  
* **League settings (configurable at creation):** roster format (default per §8), scoring profile (default per §9), playoff format, waiver type (§7.6).

### **7.3 Artist database & genre tagging (P0)**

* A database of eligible artists, each with: name, image, primary genre, secondary genre(s), external listen links (Spotify/Apple), and IDs that map to the data providers (§10).  
* **Genre source:** genre is derived from Apple's `primaryGenreName` (via the iTunes Search/Lookup API), mapped onto Bandwagon's internal genre enum. Apple labels that don't map to a named slot bucket fall back to Other.  
* Bandwagon genre buckets used for slot eligibility: Hip-Hop/R\&B, Pop, Rock, Country, plus Other (everything else — e.g., Latin, Dance/Electronic, Christian/Gospel, Alternative, Singer/Songwriter, etc., collapsed into the Niche/Flex-eligible "Other" group).  
* **Multi-genre rule:** an artist with more than one genre is classified by their primary genre for all slot-eligibility checks.

### **7.4 The draft (P0)**

* **Format:** live snake draft.  
* **Timer:** each pick has a clock (default: 60s). On expiry, the system auto-drafts the best available eligible artist (based on most recent weeks points) for a slot the team still needs (auto-draft also covers any member who can't attend).  
* **Roster slots enforced during draft:** a user may only draft an artist into a slot that artist is eligible for, and cannot exceed the count for any slot (see §8). The draft board shows which slots are still open.  
* **Draft board UI must show:** time on clock, whose pick it is, slots you still need, the available artist pool filterable by genre/slot, and a live feed of recent picks by other teams.  
* **Draft completion:** draft ends when every team has filled all 6 slots \+ 3 bench spots. Rosters lock and Week 1 lineups open.

### **7.5 Roster & weekly lineup (P0)**

* Roster format and slot eligibility are defined in §8.  
* Each scoring week, the user sets a lineup: which rostered artists are "starters" who earn points that week.  
* **Lineup lock:** lineups lock at the start of the scoring week (§9 defines the week). After lock, no roster changes affect the current week's score.

### **7.6 Free agents, waivers & trades (P1)**

* **Free agents:** any eligible artist not on a roster in that league.  
* **Waivers :** when a user wants to add a free agent, the claim goes through a waiver system to avoid the 3am-refresh problem. Rolling priority: each team has a waiver priority; claiming an artist drops you to the bottom.  
* **Adds require a corresponding drop** so rosters stay the same size.  
* **Trades:** a user proposes a trade (artist(s) for artist(s)) to another team; the other team accepts/rejects. Trades must leave both rosters slot-legal.

### **7.7 Matchups, standings & scoring display (P0)**

* **Matchups:** each scoring week, every team is paired head-to-head with another team in the league. Higher total roster points wins; record is W-L (ties broken by highest scoring single artist)  
* **Scheduling:** round-robin across the regular season so everyone plays a balanced schedule.  
* **Standings:** ranked by W-L, tiebreak by total points-for (default).  
* **Live leaderboard:** scores update on a daily batch, then finalize at week end.  
* **Per-artist score breakdown:** tapping any artist shows exactly how their weekly points were earned, broken out by each signal in §9.

### **7.8 Season structure (P0)**

* **Season length:** 10 week regular season (default).  
* **Regular season:** round-robin head-to-head weeks.  
* **Playoffs (P1):** top 4 (default) teams enter a single-elimination bracket for the final weeks; champion crowned.

### **7.9 Notifications (P1)**

* Email for: lineup-lock reminder, an artist on your roster dropped a new release, waiver results, trade offers, matchup result.

### **7.10 Achievements & season recap (P2)**

* Badges (e.g., "drafted a \#1 hit," "biggest weekly score") and a shareable end-of-season recap card to feed the viral loop.

### **7.11 League chat (P2)**

* A simple per-league message feed for trash talk.

## **8\. Roster format specification**

## Roster size: 9 artists. 6 starters and 3 bench

| Slot | Eligible Genre | Count |
| :---- | :---- | ----- |
| Hip-hop | Luminate's R\&B/Hip-Hop | 1 |
| Pop | Pop | 1 |
| Rock | Rock | 1 |
| Country | Country | 1 |
| Niche | Any other than the four required | 1 |
| Flex | Any | 1 |
| Bench | Any | 3 |

## Eligibility checks run at draft, on every add/drop, and on every trade. Any action that would leave a roster slot-illegal is rejected with a clear message.

## **9\. Scoring Specification**

* A scoring week runs Tuesday 00:00 → Sunday 23:59 (US Pacific), aligning to when the Apple Most Played chart data refreshes so chart positions and movement line up cleanly week to week.  
* Lineups lock at week start (Tuesday 00:00 Pacific).  
* Scores compute as a daily provisional batch (daily ingest job) and finalize after the week closes, when the final chart data has landed (finalize job targets \~Monday 00:01 Pacific the following week). The finalize job is idempotent — re-runs do not double-count, re-lock, or double-advance the week.

### **9.2 Signals & point values**

An artist's weekly score \= sum of the signals below. All signals are derived from the **Apple Most Played Songs chart (Top 100\) and Apple Most Played Albums chart (Top 100\)**, rolled up to the artist level (an artist's score uses their best-ranked charting song that week unless noted).

**(a) Chart rank.** Based on the artist's highest-ranked song on the Apple Most Played Songs chart that week. **\[TUNE\]**

| Best Song Rank | Points |
| :---: | :---: |
| 1 | 25 |
| 2–10 | 18 |
| 11–25 | 12 |
| 26–50 | 8 |
| 51–100 | 4 |
| Not on chart | 0 |

| Best Album Rank | Points |
| :---: | :---: |
| 1 | 25 |
| 2–10 | 18 |
| 11–25 | 12 |
| 26–50 | 8 |
| 51–100 | 4 |
| Not on chart | 0 |

**(c) Longevity.** Rewards staying power on the chart, measured as consecutive weeks the artist has held a song on the Top 100\. **\[TUNE\]**

* 0 points for week 1; \+2 points per consecutive week starting from week 2, **capped at \+10** (i.e., from the 6th consecutive week onward, no additional longevity points).

**(d) Chart movement.** Change in the artist's best chart rank vs. the prior week. **\[TUNE\]**

* \+1 point per position gained, capped at **\+15**.  
* −1 point per position lost, capped at **−10**.  
* New entry / debut on the chart this week: **\+10 bonus** (replaces movement for that week, since there's no prior position to compare).

## **10\. Data sources & integration**

* **Spine:** use Luminate (the data behind the Billboard charts) as the primary source for genre classification, US streaming volume, and chart positions/movement. This makes genre buckets (§7.3) and chart scoring (§9) authoritative and consistent.  
* **Abstraction requirement:** the app must NOT call providers directly from feature code. Build a **data-access layer** that exposes internal methods (e.g., `getWeeklyStreams(artist, week)`) and hides which provider answered. This is what makes provider swaps and fallbacks possible.  
* **Graceful degradation:** if a source drops for a week (outage, rate limit, pulled access), the system must score on the signals it *does* have, clearly flag the affected week, and recover when the source returns \- never hard-fail the whole scoring run.  
* **Licensing / ToS:** before launch, review each provider's terms for what may be stored, displayed, and computed on. This is real pre-launch work, owned by whoever handles licensing.  
* Name a **fallback source** for both streaming/charts and social, even if failover isn't built yet \- know the escape route.

## **12\. Screen-by-screen specification**

For each screen: purpose, key elements, states, and primary actions.

### **12.1 Auth**

* **Elements:** logo, sign-up / log-in toggle, email \+ password fields or OAuth buttons.  
* **States:** error (bad credentials), loading.

### **12.2 Home / Leagues list**

* **Elements:** list of the user's leagues (each card: league name, your record, your weekly score vs. opponent, next lock time), Create league and Join league CTAs.  
* **Empty state:** no leagues yet → prominent create/join with an explainer \+ "Join a public league" one-tap option.

### **12.3 League hub → Matchup (default tab)**

* **Purpose:** the recurring screen players open several times a week.  
* **Elements:** week label \+ "updates daily" badge; head-to-head score header (you vs. opponent); your 6 roster rows, each showing slot label (Hip-Hop/Pop/Rock/Country/Niche/Flex), artist avatar \+ name, , and that artist's weekly points; empty-slot rows show a Fill action; footer actions: Trades, Free agents.  
* **States:** pre-lock (lineup editable), locked (read-only for the week), empty slot (needs a free agent).

### **12.4 League hub → Standings**

* **Elements:** ranked table (rank, team, W-L, points-for), playoff cut line indicator.

### **12.5 League hub → Players / Free agents**

* **Elements:** searchable, genre-filterable artist list; each row: avatar, name, genre, season points, most recent week points, Add/Claim (subject to waivers) or Rostered by @team.

### **12.6 League hub → Trades**

* **Elements:** propose-trade builder (your artists ↔ their artists), legality check, pending offers in/out, accept/reject.

### **12.7 League hub → Settings**

* **Elements:** editable pre-season settings for commissioner (name, team count, draft time, privacy, scoring profile, waiver type); locked indicators post-draft.

### **12.8 Draft room**

* **Purpose:** live snake draft.  
* **Elements:** pick clock; "on the clock" indicator; your slots filled vs. still-needed (with the four required \+ 2 flex); available artist pool filterable by slot/genre, recent-picks feed.  
* **States:** your turn (Draft buttons active), waiting (others picking), auto-draft fired (timer expired or no-show), draft complete.

### **12.9 Artist detail**

* **Elements:** name, image, genre(s), activity status, this-week score broken down by each §9 signal, season history, Listen on Spotify/Apple link-out buttons.

### **12.10 League creation \+ invite**

* **Create flow:** name → team count → privacy → draft time → create.  
* **Invite:** generates a shareable link; tapping it (by an invitee) routes to join the league, then to signup if not authenticated, then into the league.

### **12.11 Notifications / activity feed**

* **Elements:** chronological list of relevant events (lock reminders, releases, waiver results, trade offers, results).

## **13\. Dependencies & risks**

**Dependencies:** 

* Reliable data from chart/streaming/other external sources  
* Licensing/ToS review for each data source \- what I'm allowed to use

**Risks:** 

* **Data access & cost** \- APIs change terms, rate-limit, or get expensive. *Mitigation:* abstract a data layer with multiple sources. Degrade gracefully if one drops  
* **Scoring Accuracy** \- Users could feel that scoring is unclear or incorrect. *Mitigation:* Transparent per-signal breakdowns  
* **Cold-start/Liquidity** \- Users need friends to play in a league. *Mitigation:* Offer publicly managed leagues so solo players can still play  
* **Artist relations/image rights** \- Using artist names and likeness. *Mitigation:* review of name/likeness and editorial-use boundaries
