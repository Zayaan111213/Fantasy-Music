# **Bandwagon — Product Requirements Document**

**Author:** Zayaan Rashid  
**Status:** Draft  
**Last Updated:** June 8, 2026  
**Stakeholders:** Father  
**Target Release:** August 24

---

## **1\. Overview / TL;DR**

Bandwagon is fantasy sports for music. Users draft a roster of real recording artists on their team, and then get points each week based on those artists’ real-world performances: streams, chart movement, etc. Friends compete in head-to-head leagues over a season, turning being a music fan into a competitive social game, the way fantasy football makes the actual game more interesting. Music fans already argue about who’s winning, and Bandwagon gives that argument a scoreboard.

## **2\. Problem statement**

Music fandom is passionate yet passive. People follow artists intensely, debate taste, and track releases, but there’s no shared, competitive layer that actually rewards being knowledgeable or making good predictions. Fantasy sports proved that there is a large market for turning spectatorship into competition, fantasy football alone drives tens of millions of recurring weekly users.

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
* Genre source: genre is taken from the data provider's classification (see §10), using Luminate's core genre buckets: R\&B/Hip-Hop, Rock, Pop, Country, Latin, Dance/Electronic, Christian/Gospel, World, Children, Classical.  
* Multi-genre rule: an artist tagged with more than one genre is classified by their primary genre for all slot-eligibility checks. 

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
| Hip-hop | Luminate’s R\&B/Hip-Hop | 1 |
| Pop | Pop | 1 |
| Rock | Rock | 1 |
| Country | Country | 1 |
| Niche | Any other than the four required | 1 |
| Flex | Any | 1 |
| Bench | Any | 3 |

## Eligibility checks run at draft, on every add/drop, and on every trade. Any action that would leave a roster slot-illegal is rejected with a clear message.

## **9\. Scoring Specification**

### **9.1 The scoring week**

* A scoring week aligns to the Billboard/Luminate tracking week (Friday 00:00 – Thursday 23:59, US) so chart and stream data line up cleanly. Confirm exact boundaries against the chosen provider.  
* Lineups lock at week start. Scores compute as a daily provisional batch and finalize after the week closes and final data lands.

### **9.2 Signals & point values**

An artist's weekly score \= sum of the signals below.

**(a) Streaming volume.**

* Based on the artist's US weekly on-demand audio streams.  
* Scored on a tiered curve with thresholds defined per genre, so a big week for country earns comparable points to a big week for hip-hop. This per-genre normalization is what keeps smaller-genre slots competitive instead of dead.   
* Example tiers for a large genre (hip-hop) \[TUNE\]:

| Weekly US Streams | Points |
| :---: | :---: |
| 50M \+ | 40 |
| 25M \- 50M | 30 |
| 10M \- 25M | 20 |
| 5M \- 10M | 12 |
| 1M \- 5M | 6 |
| \< 1M | 2 |
| 0 | 0 |

Smaller genres (e.g., country, Latin) use a scaled-down threshold table producing the same point range — store one threshold table per genre.

**(b) Chart position.**

* Based on the artist's highest-charting entry that week across the Billboard Hot 100 (songs) \[TUNE\]:

| Best Chart Position | Points |
| :---: | :---: |
| 1 | 25 |
| 2-10 | 18 |
| 11-25 | 12 |
| 26-50 | 8 |
| 51-100 | 4 |
| 0 | 0 |

**(c) Chart movement.**

* Change in the artist's highest-charting entry vs. the prior week \[TUNE\]:  
  * \+1 point per position gained, capped at \+15.  
  * −1 point per position lost, capped at −10.  
  * New entry / debut on a chart: \+10 bonus.

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

![][image1]

### **12.11 Notifications / activity feed**

* **Elements:** chronological list of relevant events (lock reminders, releases, waiver results, trade offers, results).

## **13\. Dependencies & risks**

**Dependencies:** 

* Reliable data from chart/streaming/other external sources  
* Licensing/ToS review for each data source \- what I’m allowed to use

**Risks:** 

* **Data access & cost** \- APIs change terms, rate-limit, or get expensive. *Mitigation:* abstract a data layer with multiple sources. Degrade gracefully if one drops  
* **Scoring Accuracy** \- Users could feel that scoring is unclear or incorrect. *Mitigation:* Transparent per-signal breakdowns  
* **Cold-start/Liquidity** \- Users need friends to play in a league. *Mitigation:* Offer publicly managed leagues so solo players can still play  
* **Artist relations/image rights** \- Using artist names and likeness. *Mitigation:* review of name/likeness and editorial-use boundaries

[image1]: <data:image/png;base64,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>