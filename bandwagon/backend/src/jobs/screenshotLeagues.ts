/**
 * Builds the demo leagues used for App Store / marketing screenshots.
 *
 * Three leagues, each covering a different set of screens:
 *   SHOT-MID   "The Hit List"   10 teams, active, mid-season (week 6 live)
 *   SHOT-CUP   "Platinum Cup"    8 teams, complete — full playoff bracket + champion
 *   SHOT-DRAFT "Rookie Season"  10 teams, pre-draft lobby with a running countdown
 *
 * Seasons are played through the REAL pipeline — updateMatchupScores() then
 * finalizeLeagueWeek() for each week in order — rather than by writing scores
 * directly. That matters: finalize is what freezes each week's LineupSnapshot,
 * resolves winners, credits standings and writes the week_result feed events, so
 * every screen agrees with every other one. Scores come from real WeeklyScore
 * rows, so a past matchup's box score adds up to its own header.
 *
 * Only chart weeks that actually have data can be scored. The regular season is
 * anchored so its last week lands on the current chart week; any league week
 * that maps to a chart week older than the data we hold scores 0 (reported at
 * the end). SHOT-MID is anchored to have none.
 *
 * Idempotent: deletes its own three leagues by invite code and rebuilds them.
 * User-created leagues and the CHART-2026 / PUBLIC-2026 demo leagues are never
 * touched.
 *
 *   npx tsx src/jobs/screenshotLeagues.ts
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../db/prisma';
import { updateMatchupScores } from '../scoring/engine';
import { weekDateForLeagueWeek } from '../scoring/weeks';
import { finalizeLeagueWeek } from './finalizePipeline';
import { buildRoundRobin } from '../utils/schedule';
import { logLeagueEvent } from '../events/leagueEvents';

const SHOT_CODES = ['SHOT-MID', 'SHOT-CUP', 'SHOT-DRAFT'];
const PASSWORD = 'password123';
const YEAR = 2026;
const REGULAR_WEEKS = 10;
const FINALS_WEEK = 12;

// Hyphenated, matching ALL_BENCH_SLOTS in the web and mobile clients. They look
// spots up by exact slot name, so 'Bench 1' renders as an empty bench.
const BENCH_SLOTS = ['Bench-1', 'Bench-2', 'Bench-3'];
const CATEGORIES = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Other'];

// Fictional owners. The first is the "hero" account — it owns a team in all
// three leagues, so its Home screen shows a realistic multi-league list.
const OWNERS = [
  { email: 'shot01@bandwagon.app', username: 'Avery', team: 'Vinyl Countdown' },
  { email: 'shot02@bandwagon.app', username: 'Jordan', team: 'Bass Fishing' },
  { email: 'shot03@bandwagon.app', username: 'Riley', team: 'The Loud Ones' },
  { email: 'shot04@bandwagon.app', username: 'Sasha', team: 'Treble Makers' },
  { email: 'shot05@bandwagon.app', username: 'Devon', team: 'Encore Mafia' },
  { email: 'shot06@bandwagon.app', username: 'Kai', team: 'Static Bloom' },
  { email: 'shot07@bandwagon.app', username: 'Noor', team: 'Hook Line and Sinker' },
  { email: 'shot08@bandwagon.app', username: 'Emery', team: 'Midnight Pressing' },
  { email: 'shot09@bandwagon.app', username: 'Rowan', team: 'Neon Cassette' },
  { email: 'shot10@bandwagon.app', username: 'Quinn', team: 'Sold Out Shows' },
  { email: 'shot11@bandwagon.app', username: 'Marlow', team: 'Reverb City' },
  { email: 'shot12@bandwagon.app', username: 'Theo', team: 'The B-Sides' },
];

type Artist = { id: string; name: string; primaryGenre: string; points: number };
type Slotted = { slot: string; artist: Artist | null };

const DAY = 86_400_000;

// A draftTime whose first scoring Tuesday is `tuesday`. firstScoringTuesdayDate
// pushes a Tuesday draft to the following week, so aim two days earlier (Sunday)
// and the league's week 1 lands exactly on `tuesday`.
function draftTimeForFirstTuesday(tuesday: Date): Date {
  return new Date(tuesday.getTime() - 2 * DAY + 19 * 3_600_000); // Sunday 19:00 UTC
}

// The newest chart week that actually holds scores, which is NOT necessarily
// the week containing today: if the daily pipeline is behind, getCurrentWeekDate()
// names a week with no rows at all. Anchoring the seasons on the calendar in that
// state scores the live week — and the championship — 0, which is exactly the
// screen nobody wants to photograph.
async function latestScoredWeek(): Promise<Date> {
  const row = await prisma.weeklyScore.findFirst({
    orderBy: { weekDate: 'desc' },
    select: { weekDate: true },
  });
  if (!row) throw new Error('No WeeklyScore rows at all — run the daily pipeline first.');
  return row.weekDate;
}

async function loadArtistPool(weekDate: Date): Promise<Artist[]> {
  const rows = await prisma.artist.findMany({
    where: { hiddenAt: null },
    select: {
      id: true,
      name: true,
      primaryGenre: true,
      weeklyScores: { where: { weekDate }, select: { totalPoints: true } },
    },
  });
  return rows
    .map((a) => ({ id: a.id, name: a.name, primaryGenre: a.primaryGenre, points: a.weeklyScores[0]?.totalPoints ?? 0 }))
    .sort((a, b) => b.points - a.points);
}

// Deals a full 9-slot roster to every team. Each genre bucket is dealt with a
// rotating offset so no single team sweeps the best artist in every category —
// that produces a believable standings spread instead of a straight ladder.
function dealRosters(pool: Artist[], teamCount: number): Slotted[][] {
  const bucketOf = (a: Artist) => (CATEGORIES.includes(a.primaryGenre) ? a.primaryGenre : 'Other');
  const buckets = new Map<string, Artist[]>(CATEGORIES.map((c) => [c, []]));
  for (const a of pool) buckets.get(bucketOf(a))!.push(a);

  const rosters: Slotted[][] = Array.from({ length: teamCount }, () => []);

  CATEGORIES.forEach((category, c) => {
    const taken = buckets.get(category)!.splice(0, teamCount);
    for (let j = 0; j < teamCount; j++) {
      // j -> team is a bijection, so every team gets exactly one of each genre.
      rosters[(j + c) % teamCount].push({ slot: category, artist: taken[j] ?? null });
    }
  });

  // Flex and bench come from whatever is left, best first, dealt round-robin.
  const rest = CATEGORIES.flatMap((c) => buckets.get(c)!).sort((a, b) => b.points - a.points);
  ['Flex', ...BENCH_SLOTS].forEach((slot, r) => {
    const taken = rest.splice(0, teamCount);
    for (let j = 0; j < teamCount; j++) {
      // Offset by round as well, so the same team doesn't take the best of
      // every remaining round the way a fixed offset would.
      rosters[(j + CATEGORIES.length + r) % teamCount].push({ slot, artist: taken[j] ?? null });
    }
  });
  return rosters;
}

interface LeagueSpec {
  code: string;
  name: string;
  owners: typeof OWNERS;
  firstTuesday: Date;
  finalizeThrough: number; // last league week to play out
}

async function buildPlayedLeague(spec: LeagueSpec, pool: Artist[]): Promise<{ leagueId: string; deadWeeks: number[] }> {
  const teamCount = spec.owners.length;
  const draftTime = draftTimeForFirstTuesday(spec.firstTuesday);

  const users = await Promise.all(spec.owners.map((o) => prisma.user.findUniqueOrThrow({ where: { email: o.email } })));

  const league = await prisma.league.create({
    data: {
      name: spec.name,
      commissionerId: users[0].id,
      teamCount,
      isPrivate: true,
      status: 'active',
      inviteCode: spec.code,
      currentWeek: 1,
      seasonYear: YEAR,
      draftTime,
    },
  });

  const teams: { id: string; name: string }[] = [];
  for (let i = 0; i < teamCount; i++) {
    teams.push(await prisma.team.create({
      data: {
        leagueId: league.id,
        userId: users[i].id,
        name: spec.owners[i].team,
        draftPosition: i + 1,
        waiverPriority: teamCount - i, // reverse draft order, as makePick seeds it
      },
    }));
  }

  const rosters = dealRosters(pool, teamCount);
  await prisma.rosterSpot.createMany({
    data: rosters.flatMap((roster, i) =>
      roster.map(({ slot, artist }) => ({ teamId: teams[i].id, artistId: artist?.id ?? null, slot })),
    ),
  });

  await prisma.matchup.createMany({
    data: buildRoundRobin(teams.map((t) => t.id), league.id, REGULAR_WEEKS),
  });

  for (let i = 1; i < teamCount; i++) {
    await logLeagueEvent(prisma, league.id, 'member_joined', `${users[i].username} joined the league as ${teams[i].name}`);
  }
  await logLeagueEvent(prisma, league.id, 'draft_complete', 'The draft is complete. The season begins!');

  // Play the season through the real pipeline, one week at a time. Scoring the
  // week before finalizing it matches production ordering: the daily pipeline
  // writes the scores, then Monday's finalize freezes the lineup and resolves
  // the winner from them.
  const deadWeeks: number[] = [];
  for (let week = 1; week <= spec.finalizeThrough; week++) {
    const weekDate = weekDateForLeagueWeek({ draftTime, currentWeek: week }, week);
    const scored = await prisma.weeklyScore.count({ where: { weekDate } });
    if (scored === 0) deadWeeks.push(week);
    await updateMatchupScores(league.id, week, weekDate);
    await finalizeLeagueWeek(league.id, week, weekDate);
  }

  // The week now in progress: score it, leave it open.
  const fresh = await prisma.league.findUniqueOrThrow({ where: { id: league.id } });
  if (fresh.status === 'active') {
    await updateMatchupScores(league.id, fresh.currentWeek, weekDateForLeagueWeek(fresh, fresh.currentWeek));
  }

  return { leagueId: league.id, deadWeeks };
}

// A pending incoming trade and a queued waiver claim, so the Trades screen and
// the waiver card have something real to show. The trade is one-for-one within
// the same genre, which is slot-legal in both directions by construction.
async function addPendingActivity(leagueId: string, pool: Artist[]): Promise<void> {
  const teams = await prisma.team.findMany({
    where: { leagueId },
    include: { rosterSpots: true },
    orderBy: { draftPosition: 'asc' },
  });
  const hero = teams[0];
  const other = teams[1];

  const genre = 'R&B/Hip-Hop';
  const heroSpot = hero.rosterSpots.find((s) => s.slot === genre && s.artistId);
  const otherSpot = other.rosterSpots.find((s) => s.slot === genre && s.artistId);
  if (heroSpot && otherSpot) {
    const trade = await prisma.trade.create({
      data: { leagueId, proposerTeamId: other.id, receiverTeamId: hero.id, status: 'pending' },
    });
    await prisma.tradeItem.createMany({
      data: [
        { tradeId: trade.id, artistId: otherSpot.artistId!, fromTeamId: other.id, toTeamId: hero.id },
        { tradeId: trade.id, artistId: heroSpot.artistId!, fromTeamId: hero.id, toTeamId: other.id },
      ],
    });
  }

  const rostered = new Set(
    (await prisma.rosterSpot.findMany({ where: { team: { leagueId } }, select: { artistId: true } }))
      .flatMap((s) => (s.artistId ? [s.artistId] : [])),
  );
  const freeAgent = pool.find((a) => !rostered.has(a.id) && a.primaryGenre === 'Pop');
  const dropSpot = hero.rosterSpots.find((s) => s.slot === 'Bench-3');
  if (freeAgent && dropSpot) {
    await prisma.waiverClaim.create({
      data: {
        leagueId,
        teamId: hero.id,
        artistId: freeAgent.id,
        dropSlot: dropSpot.slot,
        dropArtistId: dropSpot.artistId,
        priority: 1,
        status: 'pending',
      },
    });
  }
}

async function buildDraftLobby(owners: typeof OWNERS): Promise<string> {
  const users = await Promise.all(owners.map((o) => prisma.user.findUniqueOrThrow({ where: { email: o.email } })));
  // Two hours out: the lobby countdown reads as a real wait, and nothing starts
  // picking on its own while screenshots are being taken.
  const league = await prisma.league.create({
    data: {
      name: 'Rookie Season',
      commissionerId: users[0].id,
      teamCount: owners.length,
      isPrivate: true,
      status: 'pre_draft',
      inviteCode: 'SHOT-DRAFT',
      currentWeek: 1,
      seasonYear: YEAR,
      draftTime: new Date(Date.now() + 2 * 3_600_000),
    },
  });
  for (let i = 0; i < owners.length; i++) {
    await prisma.team.create({
      data: { leagueId: league.id, userId: users[i].id, name: owners[i].team, draftPosition: i + 1 },
    });
    if (i > 0) {
      await logLeagueEvent(prisma, league.id, 'member_joined', `${users[i].username} joined the league as ${owners[i].team}`);
    }
  }
  // No RosterSpot rows on purpose — makePick() creates them, so an undrafted
  // team genuinely has none.
  return league.id;
}

async function main() {
  const deleted = await prisma.league.deleteMany({ where: { inviteCode: { in: SHOT_CODES } } });
  console.log(`Deleted ${deleted.count} existing screenshot league(s)`);

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const o of OWNERS) {
    await prisma.user.upsert({
      where: { email: o.email },
      create: { email: o.email, username: o.username, passwordHash },
      update: { username: o.username },
    });
  }
  console.log(`${OWNERS.length} screenshot accounts ready`);

  const latest = await latestScoredWeek();
  const pool = await loadArtistPool(latest);
  console.log(`${pool.length} artists in the pool, ranked on the week of ${latest.toISOString().slice(0, 10)}`);

  // Mid-season: week 6 is live, so week 1 sits 5 chart weeks back — every week
  // of its season has real data.
  const mid = await buildPlayedLeague({
    code: 'SHOT-MID',
    name: 'The Hit List',
    owners: OWNERS.slice(0, 10),
    firstTuesday: new Date(latest.getTime() - 5 * 7 * DAY),
    finalizeThrough: 5,
  }, pool);
  await addPendingActivity(mid.leagueId, pool);

  // Finished season: week 12 is the live chart week, so the championship is
  // scored off real data. The earliest weeks predate the chart history.
  const cup = await buildPlayedLeague({
    code: 'SHOT-CUP',
    name: 'Platinum Cup',
    owners: [OWNERS[0], ...OWNERS.slice(2, 9)],
    firstTuesday: new Date(latest.getTime() - (FINALS_WEEK - 1) * 7 * DAY),
    finalizeThrough: FINALS_WEEK,
  }, pool);

  const draftId = await buildDraftLobby(OWNERS.slice(0, 10));

  // Playing a whole season in a few seconds emits one lineup reminder per team
  // per week — seventeen stacked banners on Home, which is an artifact of the
  // fast-forward rather than anything a real user would ever see. Drop them.
  const emails = OWNERS.map((o) => o.email);
  const spam = await prisma.notification.deleteMany({
    where: { user: { email: { in: emails } }, type: 'lineup_reminder' },
  });
  console.log(`Cleared ${spam.count} fast-forward lineup reminder(s)`);

  // Whatever is left is fictional too, and those inboxes do not exist. Retiring
  // them keeps the outbox dispatcher from spending retries on addresses that
  // can only bounce.
  const retired = await prisma.notification.updateMany({
    where: { user: { email: { in: emails } }, emailedAt: null },
    data: { emailedAt: new Date() },
  });
  console.log(`Retired ${retired.count} unsent notification(s) for the fictional accounts`);

  for (const [label, id] of [['The Hit List', mid.leagueId], ['Platinum Cup', cup.leagueId], ['Rookie Season', draftId]] as const) {
    const l = await prisma.league.findUniqueOrThrow({ where: { id } });
    console.log(`\n${label} (${l.inviteCode}) — ${l.status}, week ${l.currentWeek}`);
    const standings = await prisma.team.findMany({
      where: { leagueId: id },
      orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }],
      select: { name: true, wins: true, losses: true, pointsFor: true },
    });
    for (const t of standings) {
      console.log(`  ${t.name.padEnd(24)} ${t.wins}-${t.losses}  ${t.pointsFor.toFixed(1)} pts`);
    }
  }

  if (mid.deadWeeks.length) console.log(`\n⚠ The Hit List weeks with no chart data: ${mid.deadWeeks.join(', ')}`);
  if (cup.deadWeeks.length) console.log(`⚠ Platinum Cup weeks with no chart data (predate the chart history): ${cup.deadWeeks.join(', ')}`);

  console.log(`\nSign in as ${OWNERS[0].email} / ${PASSWORD} — that account owns a team in all three leagues.`);
}

main()
  .catch((err) => { console.error('Fatal:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
