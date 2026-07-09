import { Prisma } from '@prisma/client';

// A prisma client or an interactive-transaction handle — lets transactional
// call sites (trade accept, draft completion) write the event atomically.
type EventDb = {
  leagueEvent: {
    create: (args: { data: Prisma.LeagueEventUncheckedCreateInput }) => Promise<unknown>;
  };
};

export async function logLeagueEvent(
  db: EventDb,
  leagueId: string,
  type: string,
  message: string,
  meta?: Prisma.InputJsonValue,
): Promise<void> {
  await db.leagueEvent.create({ data: { leagueId, type, message, meta } });
}
