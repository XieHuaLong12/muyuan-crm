import { Prisma } from '@prisma/client';
import { setTimeout } from 'node:timers/promises';

function transactionConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2034';
  // Prisma 6 exposes MariaDB ER_CHECKREAD as an unknown connector error.
  // Require the database code AND its canonical message; do not retry arbitrary errors.
  return error instanceof Prisma.PrismaClientUnknownRequestError
    && /MysqlError\s*\{\s*code:\s*1020\s*,/.test(error.message)
    && /Record has changed since last read in table/.test(error.message);
}

// Pass a factory that starts a NEW transaction; never retry a query on an aborted tx.
// Keep external side effects (WhatsApp / AI calls) outside this factory.
export async function retryTransaction<T>(run: () => Promise<T>, wait: (ms: number) => Promise<unknown> = setTimeout): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await run(); }
    catch (error) {
      if (!transactionConflict(error) || attempt >= 2) throw error;
      await wait(500 * (attempt + 1));
    }
  }
}
