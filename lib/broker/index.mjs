/**
 * The one place a broker is chosen. All Redis access goes through this module's
 * broker - route handlers never import @upstash/redis themselves.
 *
 * Held on globalThis so every route bundle in one process shares it (and so a
 * dev-server recompile does not mint a fresh, empty MemoryBroker).
 */

import { MemoryBroker } from './memory.mjs';
import { RedisBroker } from './redis.mjs';

export function getBroker() {
  if (!globalThis.__flapperBroker) {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      globalThis.__flapperBroker = new RedisBroker();
    } else {
      console.warn(
        'flapper: no UPSTASH_REDIS_REST_URL - using the in-memory broker (single process only)',
      );
      globalThis.__flapperBroker = new MemoryBroker();
    }
  }
  return globalThis.__flapperBroker;
}

export function _setBrokerForTests(broker) {
  globalThis.__flapperBroker = broker;
}
