/**
 * The Upstash-backed broker. Key schema, per board:
 *
 *   board:{id}:commands   STREAM method, paramsJson, source, ts  (MAXLEN ~1000)
 *   board:{id}:state      STRING JSON {snapshot, updatedAt}
 *
 * Board identity and config live in Postgres; Redis carries only the realtime
 * channel, so every key here is ephemeral and safe to expire. The 30-day TTL,
 * refreshed by `touch()`, is garbage collection - a stream nobody has read or
 * written in a month serves no one.
 */

import { Redis } from '@upstash/redis';

const TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_COMMANDS = 1000;

const keys = (boardId) => ({
  commands: `board:${boardId}:commands`,
  state: `board:${boardId}:state`,
});

/**
 * What a caller sees when Redis is unreachable or over quota: a 503 with a
 * sentence a person can act on. The provider's own message (which names
 * plans and limits) goes to the log, never to a response.
 */
export class BrokerUnavailable extends Error {
  constructor(cause) {
    super('the realtime service is unavailable - queues and settings still save, and displays catch up when it returns');
    this.name = 'BrokerUnavailable';
    this.status = 503;
    this.cause = cause;
  }
}

async function guarded(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof BrokerUnavailable) throw error;
    throw new BrokerUnavailable(error);
  }
}

export class RedisBroker {
  constructor(redis = Redis.fromEnv()) {
    this.redis = redis;
  }

  async touch(boardId) {
    return guarded(async () => {
      const k = keys(boardId);
      const pipeline = this.redis.pipeline();
      pipeline.expire(k.commands, TTL_SECONDS);
      pipeline.expire(k.state, TTL_SECONDS);
      await pipeline.exec();
    });
  }

  async appendCommand(boardId, cmd) {
    return guarded(async () => {
      const k = keys(boardId);
      const id = await this.redis.xadd(
        k.commands,
        '*',
        {
          method: cmd.method,
          paramsJson: JSON.stringify(cmd.params ?? {}),
          source: cmd.source ?? 'api',
          ts: cmd.ts ?? Date.now(),
        },
        { trim: { type: 'MAXLEN', threshold: MAX_COMMANDS, comparison: '~' } },
      );
      await this.touch(boardId);
      return id;
    });
  }

  async commandsAfter(boardId, afterId, limit = 100) {
    return guarded(async () => {
      const start = afterId && afterId !== '0' ? `(${afterId}` : '-';
      const entries = await this.redis.xrange(keys(boardId).commands, start, '+', limit);
      return Object.entries(entries ?? {}).map(([id, fields]) => ({
        id,
        cmd: {
          method: String(fields.method),
          params: parseJson(fields.paramsJson, {}),
          source: fields.source,
          ts: Number(fields.ts) || undefined,
        },
      }));
    });
  }

  async latestCommandId(boardId) {
    return guarded(async () => {
      const entries = await this.redis.xrevrange(keys(boardId).commands, '+', '-', 1);
      const ids = Object.keys(entries ?? {});
      return ids[0] ?? '0';
    });
  }

  async setState(boardId, snapshot) {
    return guarded(async () => {
      await this.redis.set(
        keys(boardId).state,
        JSON.stringify({ snapshot, updatedAt: Date.now() }),
        { ex: TTL_SECONDS },
      );
    });
  }

  async getState(boardId) {
    return guarded(async () => {
      const raw = await this.redis.get(keys(boardId).state);
      if (raw === null || raw === undefined) return null;
      return typeof raw === 'string' ? parseJson(raw, null) : raw;
    });
  }

  async deleteBoard(boardId) {
    return guarded(async () => {
      const k = keys(boardId);
      await this.redis.del(k.commands, k.state);
    });
  }
}

function parseJson(value, fallback) {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
