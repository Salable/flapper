import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBroker } from '../lib/broker/memory.mjs';
import { sha256Hex, tokenMatches, secretsMatch, newBoardId, newWriteToken } from '../lib/broker/tokens.mjs';

/**
 * The broker contract, run against MemoryBroker always and RedisBroker when
 * UPSTASH_REDIS_REST_URL is set, so the fake cannot drift from the real thing.
 * The broker carries only the realtime channel; board identity lives in
 * Postgres and is tested in db.test.mjs.
 */
function contract(name, makeBroker, opts = {}) {
  const boardId = () => newBoardId();

  test(`${name}: commands stream in order with a moving cursor`, { skip: opts.skip }, async () => {
    const broker = await makeBroker();
    const id = boardId();
    assert.equal(await broker.latestCommandId(id), '0');
    const first = await broker.appendCommand(id, { method: 'enqueue', params: { text: 'A' } });
    const second = await broker.appendCommand(id, { method: 'clear', params: {} });

    const all = await broker.commandsAfter(id, '0', 100);
    assert.deepEqual(all.map((entry) => entry.cmd.method), ['enqueue', 'clear']);
    assert.equal(all[0].id, first);

    const tail = await broker.commandsAfter(id, first, 100);
    assert.equal(tail.length, 1);
    assert.equal(tail[0].id, second);
    assert.deepEqual(tail[0].cmd.params, {});
    assert.equal(await broker.latestCommandId(id), second);
    assert.deepEqual(await broker.commandsAfter(id, second, 100), []);
  });

  test(`${name}: state round-trips with a timestamp`, { skip: opts.skip }, async () => {
    const broker = await makeBroker();
    const id = boardId();
    assert.equal(await broker.getState(id), null);
    await broker.setState(id, { showing: { text: 'HELLO' }, queue: [] });
    const state = await broker.getState(id);
    assert.equal(state.snapshot.showing.text, 'HELLO');
    assert.ok(state.updatedAt > 0);
  });

  test(`${name}: deleteBoard clears the channel`, { skip: opts.skip }, async () => {
    const broker = await makeBroker();
    const id = boardId();
    await broker.appendCommand(id, { method: 'enqueue', params: {} });
    await broker.setState(id, { queue: [] });
    await broker.deleteBoard(id);
    assert.equal(await broker.latestCommandId(id), '0');
    assert.equal(await broker.getState(id), null);
  });
}

contract('memory', () => new MemoryBroker());

const hasRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
contract(
  'redis',
  async () => {
    const { RedisBroker } = await import('../lib/broker/redis.mjs');
    return new RedisBroker();
  },
  { skip: hasRedis ? false : 'UPSTASH_REDIS_REST_URL not set' },
);

test('tokens: ids are url-safe, secrets verify only exactly', async () => {
  assert.match(newBoardId(), /^[0-9a-z]{16}$/);
  const token = newWriteToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  const hash = await sha256Hex(token);
  assert.equal(await tokenMatches(token, hash), true);
  assert.equal(await tokenMatches(token.slice(1), hash), false);
  assert.equal(await secretsMatch(token, token), true);
  assert.equal(await secretsMatch(token.slice(1), token), false);
  assert.equal(await secretsMatch('', token), false);
  assert.equal(await secretsMatch(undefined, token), false);
});
