/**
 * Builds the handler ctx inside Next. The only file besides lib/auth.ts that
 * knows Better Auth exists - handlers receive a plain `getSession` function,
 * which is what keeps them runnable under `node --test` with a stub.
 */

import { getBroker } from '@/lib/broker/index.mjs';
import { getDb } from '@/lib/db/client.mjs';
import { sessionFromHeaders } from '@/lib/auth';

export async function apiCtx(request: Request, slug?: string) {
  return {
    broker: getBroker(),
    db: await getDb(),
    slug,
    getSession: async () => (await sessionFromHeaders(request.headers)) ?? null,
  };
}
