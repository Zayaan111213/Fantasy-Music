import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { prisma } from '../db/prisma';
import { logLeagueEvent } from '../events/leagueEvents';
import { transferCommissioner } from '../leagues/transfer';

// Account deletion. The account is always unrecoverable afterwards, but what
// happens to the row depends on what the user leaves behind:
//
// - Leagues they commission are handed to the earliest-joined other member;
//   with no one to inherit, the league is deleted (cascade).
// - Teams in leagues still `pending` are removed, same as leaving the league.
// - Teams in leagues past `pending` must survive (matchups, draft state, and
//   pick order reference them), so the team stays as an unmanaged squad and
//   the User row is kept but anonymized ("soft delete": scrubbed email and
//   username, unusable password hash, deletedAt set).
// - With nothing forcing the row to stay, the User row is hard-deleted.

export type DeleteAccountResult =
  | { ok: true; mode: 'hard' | 'soft' }
  | { error: string; status: number };

export async function deleteAccount(userId: string, password: string): Promise<DeleteAccountResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) return { error: 'User not found', status: 404 };

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return { error: 'Incorrect password', status: 403 };

  const commissioned = await prisma.league.findMany({
    where: { commissionerId: userId },
    include: {
      teams: {
        include: { user: { select: { id: true, username: true, deletedAt: true } } },
        // id backs up createdAt (TIMESTAMP(3)) as a deterministic tiebreak —
        // two teams can join in the same millisecond under concurrent joins.
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });

  const teams = await prisma.team.findMany({
    where: { userId },
    include: { league: { select: { id: true, name: true, status: true } } },
  });

  const displayName = user.username ?? 'A member';
  let mode: 'hard' | 'soft' = 'hard';

  await prisma.$transaction(
    async (tx) => {
      // Hand off commissioned leagues to the earliest-joined member who still
      // has an account; with no heir the league is deleted (cascade clears
      // teams, matchups, drafts, trades, waivers, and the feed).
      const cascadedLeagueIds = new Set<string>();
      for (const league of commissioned) {
        const heir = league.teams.find((t) => t.userId !== userId && !t.user.deletedAt);
        if (heir) {
          await transferCommissioner(tx, league, heir.user);
        } else {
          cascadedLeagueIds.add(league.id);
          await tx.league.delete({ where: { id: league.id } });
        }
      }

      const remaining = teams.filter((t) => !cascadedLeagueIds.has(t.leagueId));
      const abandoned = remaining.filter((t) => t.league.status !== 'pending');

      for (const team of remaining) {
        if (team.league.status === 'pending') {
          await logLeagueEvent(
            tx,
            team.leagueId,
            'member_left',
            `${displayName} deleted their account and left the league.`,
          );
          await tx.team.delete({ where: { id: team.id } });
        } else {
          await logLeagueEvent(
            tx,
            team.leagueId,
            'member_left',
            `${displayName} deleted their account. ${team.name} is now unmanaged.`,
          );
        }
      }

      if (abandoned.length === 0) {
        // Notifications and password reset tokens cascade off the User row.
        await tx.user.delete({ where: { id: userId } });
        return;
      }

      mode = 'soft';
      await tx.waiverClaim.updateMany({
        where: { teamId: { in: abandoned.map((t) => t.id) }, status: 'pending' },
        data: { status: 'cancelled', resolution: 'Account deleted', resolvedAt: new Date() },
      });
      await tx.notification.deleteMany({ where: { userId } });
      // A reset link issued before deletion must not be able to reactivate
      // the account.
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId}@deleted.local`,
          username: `deleted_${userId.slice(-12)}`,
          // Not a valid bcrypt hash, so no password can ever compare true.
          passwordHash: '!account-deleted',
          avatarUrl: null,
          deletedAt: new Date(),
        },
      });
    },
    { timeout: 15_000 },
  );

  if (user.avatarUrl?.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, '../../uploads', user.avatarUrl.slice('/uploads/'.length));
    fs.unlink(filePath, (err) => {
      if (err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Failed to delete avatar of removed account:', err);
      }
    });
  }

  console.log(`[account] user ${userId} deleted (${mode})`);
  return { ok: true, mode };
}
