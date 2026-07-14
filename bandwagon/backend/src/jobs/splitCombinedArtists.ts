import { prisma } from '../db/prisma';
import { splitArtistCredit } from '../data/artistCredits';
import { assignRoster, type RosterArtist } from '../trades/engine';
import { ALL_SLOTS } from '../api/routes/draft';
import { logLeagueEvent } from '../events/leagueEvents';
import { getCurrentWeekDate } from './ingestCharts';
import { scoreArtistWeekFromCharts, updateMatchupScores } from '../scoring/engine';

// One-off admin script: splits existing combined-credit Artist rows
// ("Kanye West & Don Toliver") into their individual artists so each scores
// the shared songs. Idempotent — processed combined rows get hiddenAt set and
// are skipped on re-runs. Usage:
//   DATABASE_URL="<url>" npx tsx src/jobs/splitCombinedArtists.ts [--dry-run]
//
// Per combined artist: upsert components by exact name, duplicate its chart
// entries per component (new 4-col unique makes this skip-if-exists),
// re-point roster spots to the first-listed available component (legality via
// assignRoster), invalidate pending waiver claims and open trades touching
// it, hide it, and log a feed event per affected league. Afterwards, re-score
// the components for every league week and refresh current matchup totals.

interface SpotFix {
  leagueId: string;
  teamId: string;
  teamName: string;
  replacement: string | null; // artist name or null when the spot was emptied
}

// Picks the first component (credit order) not already rostered in the league
// that has a legal placement on the team. Pure given its inputs — exported
// for unit tests.
export function chooseReplacement(
  components: RosterArtist[],
  takenArtistIds: Set<string>,
  keep: { slot: string; artist: RosterArtist }[],
): { artist: RosterArtist; assignment: Map<string, string> } | null {
  for (const candidate of components) {
    if (takenArtistIds.has(candidate.id)) continue;
    const assignment = assignRoster(keep, [candidate], ALL_SLOTS);
    if (assignment) return { artist: candidate, assignment };
  }
  return null;
}

async function upsertComponent(name: string, genre: string, dryRun: boolean) {
  const existing = await prisma.artist.findFirst({ where: { name } });
  if (existing) return { artist: existing, created: false };
  if (dryRun) {
    return { artist: { id: `dry:${name}`, name, primaryGenre: genre } as RosterArtist & { name: string }, created: true };
  }
  // Combined row's genre is the initial guess; genreEnrichedAt stays null so
  // the next daily pipeline re-resolves it via iTunes name search. imageUrl
  // stays null so the image backfill fetches the artist's own picture.
  const artist = await prisma.artist.create({ data: { name, primaryGenre: genre } });
  return { artist, created: true };
}

export async function splitCombinedArtists(dryRun: boolean): Promise<void> {
  const label = dryRun ? '[split:dry-run]' : '[split]';
  const visible = await prisma.artist.findMany({ where: { hiddenAt: null } });
  const combined = visible.filter((a) => splitArtistCredit(a.name).length > 1);

  if (combined.length === 0) {
    console.log(`${label} no combined-credit artists found — nothing to do`);
    return;
  }
  console.log(`${label} found ${combined.length} combined artist(s): ${combined.map((a) => `"${a.name}"`).join(', ')}`);

  const affectedComponentIds = new Set<string>();

  for (const c of combined) {
    const names = splitArtistCredit(c.name);
    console.log(`\n${label} "${c.name}" → ${names.join(' | ')}`);

    // 1. Components
    const components: (RosterArtist & { name: string })[] = [];
    for (const name of names) {
      const { artist, created } = await upsertComponent(name, c.primaryGenre, dryRun);
      components.push({ id: artist.id, primaryGenre: artist.primaryGenre, name });
      console.log(`${label}   component "${name}": ${created ? 'created' : 'exists'} (${artist.id})`);
      affectedComponentIds.add(artist.id);
    }

    // 2. Duplicate chart entries per component
    const [songEntries, albumEntries] = await Promise.all([
      prisma.chartEntry.findMany({ where: { artistId: c.id } }),
      prisma.albumChartEntry.findMany({ where: { artistId: c.id } }),
    ]);
    console.log(`${label}   duplicating ${songEntries.length} song + ${albumEntries.length} album entries × ${components.length} components`);
    if (!dryRun) {
      for (const comp of components) {
        for (const e of songEntries) {
          await prisma.chartEntry.upsert({
            where: { weekDate_chart_rank_artistId: { weekDate: e.weekDate, chart: e.chart, rank: e.rank, artistId: comp.id } },
            update: {},
            create: { weekDate: e.weekDate, chart: e.chart, rank: e.rank, songTitle: e.songTitle, appleSongId: e.appleSongId, artistId: comp.id },
          });
        }
        for (const e of albumEntries) {
          await prisma.albumChartEntry.upsert({
            where: { weekDate_chart_rank_artistId: { weekDate: e.weekDate, chart: e.chart, rank: e.rank, artistId: comp.id } },
            update: {},
            create: { weekDate: e.weekDate, chart: e.chart, rank: e.rank, albumTitle: e.albumTitle, appleAlbumId: e.appleAlbumId, artistId: comp.id },
          });
        }
      }
    }

    // 3. Re-point roster spots (serially: each assignment changes what's taken)
    const spots = await prisma.rosterSpot.findMany({
      where: { artistId: c.id },
      include: {
        team: {
          include: {
            rosterSpots: { include: { artist: { select: { id: true, primaryGenre: true } } } },
          },
        },
      },
    });
    const fixes: SpotFix[] = [];
    for (const spot of spots) {
      const leagueId = spot.team.leagueId;
      const leagueSpots = await prisma.rosterSpot.findMany({
        where: { team: { leagueId }, artistId: { not: null } },
        select: { artistId: true },
      });
      const taken = new Set(leagueSpots.map((s) => s.artistId!));
      const keep = spot.team.rosterSpots
        .filter((s) => s.artistId && s.id !== spot.id && s.artist)
        .map((s) => ({ slot: s.slot, artist: { id: s.artist!.id, primaryGenre: s.artist!.primaryGenre } }));

      const choice = chooseReplacement(components, taken, keep);
      const fix: SpotFix = {
        leagueId,
        teamId: spot.teamId,
        teamName: spot.team.name,
        replacement: choice?.artist ? components.find((x) => x.id === choice.artist.id)!.name : null,
      };
      fixes.push(fix);
      console.log(`${label}   roster: ${spot.team.name} (${spot.slot}) → ${fix.replacement ?? 'emptied'}`);

      if (!dryRun) {
        if (choice) {
          // Apply the full slot assignment (candidate + any relocated keeps)
          for (const slot of ALL_SLOTS) {
            const newArtistId = choice.assignment.get(slot) ?? null;
            const current = spot.team.rosterSpots.find((s) => s.slot === slot);
            if ((current?.artistId ?? null) !== newArtistId) {
              await prisma.rosterSpot.updateMany({
                where: { teamId: spot.teamId, slot },
                data: { artistId: newArtistId },
              });
            }
          }
        } else {
          await prisma.rosterSpot.update({ where: { id: spot.id }, data: { artistId: null } });
        }
        await prisma.notification.createMany({
          data: [{
            userId: spot.team.userId,
            leagueId,
            type: 'artist_split',
            message: choice
              ? `"${c.name}" was split into individual artists — your roster now has ${fix.replacement} instead.`
              : `"${c.name}" was split into individual artists. All of them are already rostered in your league, so your ${spot.slot} slot is now open.`,
          }],
        });
      }
    }

    // 4. Invalidate pending waiver claims touching the combined artist
    const claims = await prisma.waiverClaim.findMany({
      where: { status: 'pending', OR: [{ artistId: c.id }, { dropArtistId: c.id }] },
      include: { team: { select: { userId: true } } },
    });
    if (claims.length) console.log(`${label}   invalidating ${claims.length} pending waiver claim(s)`);
    if (!dryRun && claims.length) {
      await prisma.waiverClaim.updateMany({
        where: { id: { in: claims.map((cl) => cl.id) } },
        data: { status: 'invalid', resolution: 'artist credit was split into individual artists', resolvedAt: new Date() },
      });
      await prisma.notification.createMany({
        data: claims.map((cl) => ({
          userId: cl.team.userId,
          leagueId: cl.leagueId,
          type: 'waiver_result',
          message: `Your waiver claim involving "${c.name}" was cancelled: the artist credit was split into individual artists.`,
        })),
      });
    }

    // 5. Cancel open trades containing the combined artist
    const trades = await prisma.trade.findMany({
      where: { status: { in: ['pending', 'accepted'] }, items: { some: { artistId: c.id } } },
      include: {
        proposerTeam: { select: { userId: true, name: true } },
        receiverTeam: { select: { userId: true, name: true } },
      },
    });
    if (trades.length) console.log(`${label}   cancelling ${trades.length} open trade(s)`);
    if (!dryRun && trades.length) {
      await prisma.trade.updateMany({
        where: { id: { in: trades.map((t) => t.id) } },
        data: { status: 'cancelled', resolvedAt: new Date() },
      });
      await prisma.notification.createMany({
        data: trades.flatMap((t) => [t.proposerTeam, t.receiverTeam].map((team) => ({
          userId: team.userId,
          leagueId: t.leagueId,
          type: 'trade_cancelled',
          message: `A trade between ${t.proposerTeam.name} and ${t.receiverTeam.name} was cancelled: "${c.name}" was split into individual artists.`,
        }))),
      });
    }

    // 6. Hide the combined row + feed events
    if (!dryRun) {
      await prisma.artist.update({ where: { id: c.id }, data: { hiddenAt: new Date() } });
      const leagueIds = new Set([
        ...fixes.map((f) => f.leagueId),
        ...claims.map((cl) => cl.leagueId),
        ...trades.map((t) => t.leagueId),
      ]);
      for (const leagueId of leagueIds) {
        const leagueFixes = fixes.filter((f) => f.leagueId === leagueId);
        const detail = leagueFixes
          .map((f) => (f.replacement ? `${f.teamName} now has ${f.replacement}` : `${f.teamName}'s slot was emptied`))
          .join('; ');
        await logLeagueEvent(
          prisma,
          leagueId,
          'artist_split',
          `"${c.name}" was split into ${names.join(', ')} — each now scores the shared songs${detail ? `. ${detail}` : ''}.`,
        );
      }
    }
  }

  // 7. Re-score the components for every league week, then refresh current matchups
  if (dryRun) {
    console.log(`\n${label} would re-score ${affectedComponentIds.size} component artist(s) across all league weeks`);
    return;
  }
  const leagues = await prisma.league.findMany({
    where: { status: 'active' },
    select: { id: true, currentWeek: true, seasonYear: true },
  });
  const currentWeekDate = getCurrentWeekDate();
  const scored = new Set<string>();
  for (const league of leagues) {
    for (let w = 1; w <= league.currentWeek; w++) {
      const key = `${w}/${league.seasonYear}`;
      if (scored.has(key)) continue;
      scored.add(key);
      const weekDate = new Date(currentWeekDate.getTime() - (league.currentWeek - w) * 7 * 24 * 60 * 60 * 1000);
      for (const artistId of affectedComponentIds) {
        await scoreArtistWeekFromCharts(artistId, w, league.seasonYear, weekDate);
      }
    }
  }
  for (const league of leagues) {
    await updateMatchupScores(league.id, league.currentWeek, league.seasonYear);
  }
  console.log(`\n${label} re-scored ${affectedComponentIds.size} artist(s) over ${scored.size} week(s); matchups refreshed for ${leagues.length} league(s)`);
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  splitCombinedArtists(dryRun)
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error('Fatal:', err);
      prisma.$disconnect().finally(() => process.exit(1));
    });
}
