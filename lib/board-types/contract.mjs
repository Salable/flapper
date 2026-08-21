/**
 * The board-type contract: what a definition must provide to load into
 * Flapper. docs/BOARD-TYPES.md is the authoring guide; the harness in
 * tests/board-type-contract.test.mjs enforces everything here against every
 * registered type, so a new type passes by construction.
 *
 * Rules that keep the system safe (enforced by the harness):
 *  - definition.mjs is server-safe: pure data and pure functions, imports
 *    only from lib/, never react or anything 'use client'.
 *  - Client pieces live in components/board-types/ and are referenced via
 *    the client registry, which must list exactly the same ids.
 *  - Types do NOT add server routes (v1 non-goal); everything a type does
 *    flows through the hooks below, called from the generic handlers.
 *  - Host owns durations, clocks, and persistence. A type never reads
 *    Date.now() - time arrives as arguments.
 */

import { reject } from '../api/errors.mjs';

/** Param kinds the generic create/settings forms know how to render. */
const PARAM_KINDS = ['text', 'number', 'select', 'checkbox', 'message'];

/**
 * Validate a config object against a type's param schema. Used at board
 * creation and by the contract harness. Returns the config with defaults
 * applied; rejects with a named 422 otherwise.
 */
export function applyParams(params, input = {}) {
  const config = {};
  for (const param of params) {
    const raw = input[param.key];
    if (raw === undefined) {
      if (param.required) reject(`${param.key} is required`, 422);
      if (param.default !== undefined) config[param.key] = param.default;
      continue;
    }
    switch (param.kind) {
      case 'text':
      case 'message':
        if (typeof raw !== 'string') reject(`${param.key} must be a string`, 422);
        if (param.maxLength && raw.length > param.maxLength) {
          reject(`${param.key} must be at most ${param.maxLength} characters`, 422);
        }
        config[param.key] = raw;
        break;
      case 'number': {
        const value = Number(raw);
        if (!Number.isFinite(value)) reject(`${param.key} must be a number`, 422);
        if (param.min !== undefined && value < param.min) {
          reject(`${param.key} must be at least ${param.min}`, 422);
        }
        if (param.max !== undefined && value > param.max) {
          reject(`${param.key} must be at most ${param.max}`, 422);
        }
        config[param.key] = param.integer ? Math.round(value) : value;
        break;
      }
      case 'select':
        if (!param.options.some((option) => option.value === raw)) {
          reject(`${param.key} must be one of ${param.options.map((o) => o.value).join(', ')}`, 422);
        }
        config[param.key] = raw;
        break;
      case 'checkbox':
        if (typeof raw !== 'boolean') reject(`${param.key} must be true or false`, 422);
        config[param.key] = raw;
        break;
      default:
        reject(`unknown param kind ${param.kind}`, 500);
    }
  }
  return config;
}

/** Shape check used by the harness; throws plain Errors (test-time only). */
export function assertDefinition(definition) {
  const need = (cond, what) => {
    if (!cond) throw new Error(`board type ${definition?.id ?? '?'}: ${what}`);
  };
  need(typeof definition.id === 'string' && /^[a-z][a-z0-9-]*$/.test(definition.id), 'valid id');
  need(typeof definition.name === 'string' && definition.name.length > 0, 'name');
  need(typeof definition.tagline === 'string', 'tagline');
  need(typeof definition.description === 'string', 'description');
  need(Number.isInteger(definition.configVersion), 'configVersion integer');
  need(typeof definition.migrateConfig === 'function', 'migrateConfig()');
  need(Array.isArray(definition.createParams), 'createParams array');
  for (const param of definition.createParams) {
    need(PARAM_KINDS.includes(param.kind), `param ${param.key} has known kind`);
    need(typeof param.key === 'string' && param.key.length > 0, 'param key');
    need(typeof param.label === 'string', `param ${param.key} label`);
    need(
      param.advanced === undefined || typeof param.advanced === 'boolean',
      `param ${param.key} advanced is a boolean`,
    );
  }
  need(Array.isArray(definition.itemParams), 'itemParams array');
  need(typeof definition.queuePolicy?.cap === 'function', 'queuePolicy.cap()');
  need(['roll', 'reject'].includes(definition.queuePolicy.onFull), 'queuePolicy.onFull');
  need(typeof definition.queuePolicy.isPending === 'function', 'queuePolicy.isPending()');
  need(['live', 'clock'].includes(definition.playback), 'playback machine');
  need(typeof definition.ingest === 'function', 'ingest()');
  if (definition.playback === 'clock') {
    need(typeof definition.itemAt === 'function', 'clock types need itemAt()');
    need(typeof definition.snapshotExtras === 'function', 'clock types need snapshotExtras()');
  }
  need(Array.isArray(definition.capabilities), 'capabilities list');
  // Catalogue metadata - all data, all optional.
  need(definition.sample === undefined || typeof definition.sample === 'string', 'sample is a string');
  need(
    definition.recommended === undefined || typeof definition.recommended === 'boolean',
    'recommended is a boolean',
  );
  need(
    definition.tier === undefined || (typeof definition.tier === 'string' && definition.tier.length > 0),
    'tier is a non-empty string',
  );
}

/**
 * May this account create a board of this type? The mechanism behind any
 * catalogue entry that is locked: a type may name a `tier`, an account has
 * one (`user.tier`, 'standard' by default), and the ladder below decides.
 * Enforced in createBoard, which REST and the MCP create_board tool share -
 * a greyed-out card is decoration; this is the paywall. No shipped type
 * names a tier yet; the ladder is where Salable's answer will plug in.
 */
const TIER_LADDER = ['standard', 'plus', 'pro'];

export function entitled(definition, accountTier = 'standard') {
  if (!definition.tier) return true;
  const need = TIER_LADDER.indexOf(definition.tier);
  const have = TIER_LADDER.indexOf(accountTier);
  if (need < 0) return false; // a tier this build has never heard of: locked
  return have >= need;
}
