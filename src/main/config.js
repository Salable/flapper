'use strict';

const DEFAULT_PORT = 4747;
const DEFAULT_HOST = '127.0.0.1';
const PUBLIC_HOST = '0.0.0.0';

// Hosts that are only reachable from this machine.
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);

function isLoopback(host) {
  return LOOPBACK.has(String(host).toLowerCase());
}

function flag(argv, name) {
  const prefix = `--${name}=`;
  const match = argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

/**
 * Resolve server configuration.
 *
 * There is no authentication: the API is either reachable from this machine only
 * (the default) or from anywhere on the network. That is a deliberate trade for a
 * display on a trusted network — while Public is on, anyone who can reach the
 * port can put anything on the board. Treat the network boundary as the only
 * control, and don't enable it on an untrusted one.
 *
 * @param {object} env
 * @param {string[]} argv
 * @param {{defaultHost?: string}} [overrides] `defaultHost` lets the saved
 *   "public access" preference act as the default without overriding an explicit
 *   `--host` / `FLAPPER_HOST`.
 */
function readConfig(env = process.env, argv = process.argv.slice(1), overrides = {}) {
  const { defaultHost = DEFAULT_HOST } = overrides;

  const explicitHost = flag(argv, 'host') ?? env.FLAPPER_HOST;
  const host = explicitHost ?? defaultHost;
  const portRaw = flag(argv, 'port') ?? env.FLAPPER_PORT ?? String(DEFAULT_PORT);
  const corsOrigin = flag(argv, 'cors') ?? env.FLAPPER_CORS_ORIGIN ?? '';

  const enabled = !argv.includes('--no-server') && env.FLAPPER_SERVER !== '0';

  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid port: ${portRaw}`);
  }

  return {
    enabled,
    host,
    port,
    corsOrigin,
    loopback: isLoopback(host),
    // An explicit host on the command line or in the environment wins over the
    // saved preference, so the control-panel toggle cannot override how an
    // installation was deliberately launched.
    hostLocked: explicitHost !== undefined,
    maxBodyBytes: 256 * 1024,
    maxTextLength: 20000,
    maxRows: 200,
  };
}

module.exports = { readConfig, isLoopback, DEFAULT_PORT, DEFAULT_HOST, PUBLIC_HOST };
