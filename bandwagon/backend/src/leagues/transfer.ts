import { Prisma } from '@prisma/client';
import { logLeagueEvent } from '../events/leagueEvents';

// A prisma client or an interactive-transaction handle, so account deletion
// can hand off leagues atomically inside its own transaction (same pattern as
// logLeagueEvent's EventDb).
type TransferDb = {
  league: {
    update: (args: { where: { id: string }; data: { commissionerId: string } }) => Promise<unknown>;
  };
  notification: {
    create: (args: { data: Prisma.NotificationUncheckedCreateInput }) => Promise<unknown>;
  };
  leagueEvent: {
    create: (args: { data: Prisma.LeagueEventUncheckedCreateInput }) => Promise<unknown>;
  };
};

// Hands a league's commissionership to another member: updates the league,
// notifies the new commissioner, and announces it on the league feed. Callers
// are responsible for validating that the target owns a team in the league
// and is not soft-deleted.
export async function transferCommissioner(
  db: TransferDb,
  league: { id: string; name: string },
  newCommissioner: { id: string; username: string | null },
): Promise<void> {
  await db.league.update({
    where: { id: league.id },
    data: { commissionerId: newCommissioner.id },
  });
  await db.notification.create({
    data: {
      userId: newCommissioner.id,
      leagueId: league.id,
      type: 'commissioner_transfer',
      message: `You are now the commissioner of ${league.name}.`,
    },
  });
  await logLeagueEvent(
    db,
    league.id,
    'commissioner_transferred',
    `${newCommissioner.username ?? 'A member'} is now the league commissioner.`,
  );
}
