import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOARD_TYPES, getBoardType, migratedConfig } from '../lib/board-types/index.mjs';
import { assertDefinition, applyParams } from '../lib/board-types/contract.mjs';

/**
 * The board-type contract harness. Every registered type - including one an
 * agent wrote five minutes ago - must pass everything here before it can
 * ship. docs/BOARD-TYPES.md tells authors how; this file keeps them honest.
 */

const types = [...BOARD_TYPES.values()];

test('the registry has at least the built-in types and no duplicate ids', () => {
  assert.ok(types.length >= 1);
  assert.ok(getBoardType('live'));
  assert.equal(new Set(types.map((t) => t.id)).size, types.length);
});

test('every definition satisfies the shape contract', () => {
  for (const type of types) assertDefinition(type);
});

test('server and client registries list exactly the same type ids', () => {
  const clientSource = readFileSync(
    new URL('../components/board-types/registry.ts', import.meta.url),
    'utf8',
  );
  for (const type of types) {
    assert.ok(
      clientSource.includes(`id: '${type.id}'`),
      `type ${type.id} missing from components/board-types/registry.ts`,
    );
  }
  const clientIds = [...clientSource.matchAll(/id: '([a-z0-9-]+)'/g)].map((m) => m[1]);
  for (const id of clientIds) {
    assert.ok(getBoardType(id), `client registry lists unknown type ${id}`);
  }
});

test('definitions are server-safe: no react, no client imports', () => {
  for (const type of types) {
    const source = readFileSync(
      new URL(`../lib/board-types/${type.id}/definition.mjs`, import.meta.url),
      'utf8',
    );
    assert.ok(!/from ['"]react/.test(source), `${type.id}: definitions must not import react`);
    assert.ok(!/use client/.test(source), `${type.id}: definitions are server modules`);
    for (const match of source.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
      assert.ok(
        !match[1].includes('components/') && !match[1].includes('/app/'),
        `${type.id}: definition imports outside lib/ (${match[1]})`,
      );
    }
  }
});

test('createParams produce a valid default config; bad input is a named 422', () => {
  for (const type of types) {
    const config = applyParams(type.createParams, {});
    assert.equal(typeof config, 'object', type.id);
    // Version migration round-trips the default config.
    const migrated = migratedConfig(type, config);
    assert.equal(migrated.__v, type.configVersion, type.id);
    const numberParam = type.createParams.find((param) => param.kind === 'number');
    if (numberParam) {
      assert.throws(
        () => applyParams(type.createParams, { [numberParam.key]: 'not-a-number' }),
        (e) => e.status === 422,
        `${type.id}: ${numberParam.key} must reject junk`,
      );
    }
  }
});

test('queuePolicy is sane for every type', () => {
  for (const type of types) {
    const config = applyParams(type.createParams, {});
    const cap = type.queuePolicy.cap(config);
    assert.ok(cap > 0, `${type.id}: cap must be positive`);
    assert.equal(
      typeof type.queuePolicy.isPending({ id: 'x' }, { currentItemId: 'y' }),
      'boolean',
      `${type.id}: isPending returns a boolean`,
    );
  }
});

test('ingest is total over every priority and returns a placement or entry', () => {
  const entry = { payload: { text: 'HELLO', options: {} }, loop: false, source: 'api' };
  const snapshot = { items: [], currentItemId: null, currentState: 'idle', epoch: 0 };
  for (const type of types) {
    const config = applyParams(type.createParams, {});
    for (const priority of ['normal', 'next', 'now']) {
      const result = type.ingest(priority, { ...entry }, { snapshot, config, nowMs: 1_000_000 });
      assert.ok(result && typeof result === 'object', `${type.id}/${priority}`);
      assert.ok(result.entry, `${type.id}/${priority}: entry`);
      assert.ok(
        ['now', 'next', 'append'].includes(result.placement),
        `${type.id}/${priority}: placement`,
      );
    }
  }
});

test('clock types produce JSON-serializable snapshot extras and a total itemAt', () => {
  for (const type of types.filter((t) => t.playback === 'clock')) {
    const config = applyParams(type.createParams, {});
    const extras = type.snapshotExtras(
      { id: 'b', config },
      { items: [], currentItemId: null },
      1_000_000,
    );
    assert.equal(typeof JSON.parse(JSON.stringify(extras)), 'object', type.id);
    const result = type.itemAt([], null, config, 1_000_000);
    assert.ok(result === null || typeof result === 'object', type.id);
  }
});
