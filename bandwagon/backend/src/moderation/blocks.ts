import { prisma } from '../db/prisma';

/**
 * Blocking, as it can actually work in this app.
 *
 * A league is a fixed roster for a whole season, and matchups, draft picks and
 * trades all reference teams. Removing a blocked person from your league
 * mid-season isn't possible without destroying the season's history, and
 * guideline 1.2 doesn't ask for it. What it asks is that you can stop seeing a
 * user's content, so a block redacts the things they author that you'd
 * otherwise see: their username, avatar, team name and team logo.
 */

export const BLOCKED_LABEL = 'Blocked user';
export const BLOCKED_TEAM_LABEL = 'Blocked team';

/** The set of userIds this viewer has blocked. Empty for an anonymous viewer. */
export async function blockedUserIds(viewerId: string | undefined): Promise<Set<string>> {
  if (!viewerId) return new Set();
  const rows = await prisma.userBlock.findMany({
    where: { blockerId: viewerId },
    select: { blockedId: true },
  });
  return new Set(rows.map((r) => r.blockedId));
}

/**
 * Redacts the display fields on a flat row that carries an owning userId
 * alongside the names and images — the shape the standings, roster-owner and
 * public-league payloads already return.
 *
 * Never redacts the viewer's own row, so a stray self-block can't hide you
 * from yourself.
 */
export function redactRow<
  T extends {
    userId?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
    teamName?: string | null;
    teamLogoUrl?: string | null;
  },
>(row: T, blocked: Set<string>, viewerId?: string): T {
  const ownerId = row.userId;
  if (!ownerId || ownerId === viewerId || !blocked.has(ownerId)) return row;
  return {
    ...row,
    username: BLOCKED_LABEL,
    avatarUrl: null,
    ...(row.teamName !== undefined ? { teamName: BLOCKED_TEAM_LABEL } : {}),
    ...(row.teamLogoUrl !== undefined ? { teamLogoUrl: null } : {}),
  };
}
