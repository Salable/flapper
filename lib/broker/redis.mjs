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

export class RedisBroker {
  constructor(redis = Redis.fromEnv()) {
    this.redis = redis;
  }

  async touch(boardId) {
    const k = keys(boardId);
    const pipeline = this.redis.pipeline();
    pipeline.expire(k.commands, TTL_SECONDS);
    pipeline.expire(k.state, TTL_SECONDS);
    await pipeline.exec();
  }

  async appendCommand(boardId, cmd) {
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
  }

  async commandsAfter(boardId, afterId, limit = 100) {
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
  }

  async latestCommandId(boardId) {
    const entries = await this.redis.xrevrange(keys(boardId).commands, '+', '-', 1);
    const ids = Object.keys(entries ?? {});
    return ids[0] ?? '0';
  }

  async setState(boardId, snapshot) {
    await this.redis.set(
      keys(boardId).state,
      JSON.stringify({ snapshot, updatedAt: Date.now() }),
      { ex: TTL_SECONDS },
    );
  }

  async getState(boardId) {
    const raw = await this.redis.get(keys(boardId).state);
    if (raw === null || raw === undefined) return null;
    return typeof raw === 'string' ? parseJson(raw, null) : raw;
  }

  async deleteBoard(boardId) {
    const k = keys(boardId);
    await this.redis.del(k.commands, k.state);
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
