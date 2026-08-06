import { Prisma, PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Runs read-only work against a single database snapshot.
 *
 * Prisma loads `include`d relations with SEPARATE queries rather than one join,
 * and under Postgres's default READ COMMITTED every statement gets its own
 * snapshot. So a delete that commits between the parent query and the relation
 * query returns parent rows whose required relation has already vanished, and
 * Prisma throws `Inconsistent query result: Field <rel> is required to return
 * data, got null` — a 500 on an ordinary read. The data is never actually
 * inconsistent: the FKs are ON DELETE RESTRICT, so the dangling row cannot
 * exist on disk. Only the pair of reads disagrees.
 *
 * The window is small but reachable in production: a commissioner deleting a
 * league, or an account deletion cascading one away, while another member has
 * that league's matchup or standings view open.
 *
 * REPEATABLE READ pins one snapshot for the whole callback, so either every row
 * is visible to it or none is. Callers must keep the callback read-only, which
 * also means it can never hit a serialization conflict.
 */
export function readSnapshot<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}
