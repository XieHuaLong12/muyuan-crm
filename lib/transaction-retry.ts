import { Prisma } from '@prisma/client';
import { setTimeout } from 'node:timers/promises';

// Pass a factory that starts a NEW transaction; never retry a query on an aborted tx.
// Keep external side effects (WhatsApp / AI calls) outside this factory.
export async function retryTransaction<T>(run: () => Promise<T>, wait: (ms: number) => Promise<unknown> = setTimeout): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await run(); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt >= 2) throw error;
      await wait(500 * (attempt + 1));
    }
  }
}
