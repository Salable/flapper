'use strict';

const { ipcMain } = require('electron');
const os = require('node:os');
const server = require('./server');
const settings = require('./settings');
const { readConfig, isLoopback, DEFAULT_HOST, PUBLIC_HOST } = require('./config');

/**
 * Owns how the control API is reachable: local only or public, and the token.
 *
 * Kept out of main.js so the whole path — resolve config, bind, rebind on
 * toggle — can be exercised by a test harness rather than only by hand.
 */

let userDataDir = null;
let version = '0.0.0';
let stored = { publicAccess: false };
let config = { enabled: false };
let configError = null;
let serverInfo = null;

function resolveConfig() {
  return readConfig(process.env, process.argv.slice(1), {
    defaultHost: stored.publicAccess ? PUBLIC_HOST : DEFAULT_HOST,
  });
}

/**
 * URLs another machine could actually use. `0.0.0.0` is what we bind, but it is
 * not something anyone can type, so resolve the real interface addresses.
 */
function reachableUrls(port) {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const nic of entries || []) {
      if (nic.family === 'IPv4' && !nic.internal) urls.push(`http://${nic.address}:${port}`);
    }
  }
  return urls;
}

/** What the renderer is told about how the API is reachable. */
function describe() {
  const isPublic = config.host ? !isLoopback(config.host) : false;
  return {
    enabled: Boolean(serverInfo),
    url: serverInfo ? serverInfo.url : null,
    host: config.host ?? null,
    port: config.port ?? null,
    isPublic,
    // Addresses another machine can use; empty while local only.
    addresses: isPublic && serverInfo ? reachableUrls(config.port) : [],
    // True when --host / FLAPPER_HOST was given, so the toggle must not fight it.
    locked: Boolean(config.hostLocked),
    error: configError ? configError.message : null,
  };
}

async function start() {
  configError = null;
  try {
    config = resolveConfig();
  } catch (error) {
    configError = error;
    config = { enabled: false };
    console.error(`flapper: control server not started - ${error.message}`);
    return describe();
  }

  if (!config.enabled) {
    console.log('flapper: control API disabled');
    return describe();
  }

  try {
    serverInfo = await server.start(config, version);
    const scope = config.loopback ? 'this machine only' : 'all interfaces, no auth';
    console.log(`flapper: control API on ${serverInfo.url} (${scope})`);
  } catch (error) {
    serverInfo = null;
    const message =
      error.code === 'EADDRINUSE'
        ? `port ${config.port} is already in use. Set FLAPPER_PORT to something else.`
        : error.message;
    configError = new Error(message);
    console.error(`flapper: control server failed to start - ${message}`);
  }
  return describe();
}

async function restart() {
  await server.stop(serverInfo);
  serverInfo = null;
  return start();
}

/**
 * Turn network access on or off and rebind.
 *
 * Reachable only from our own window over IPC, never over the REST API: letting
 * an API caller open the board to the network would escalate "can set text" into
 * "can expose this machine".
 */
async function setPublic(enabled) {
  if (config.hostLocked) {
    return { ...describe(), rejected: 'host was set at launch' };
  }
  stored.publicAccess = Boolean(enabled);
  if (userDataDir) settings.savePublicAccess(userDataDir, stored.publicAccess);
  return restart();
}

function init(options = {}) {
  userDataDir = options.userDataDir || null;
  version = options.version || version;
  stored = userDataDir ? settings.load(userDataDir) : { publicAccess: false };
  return stored;
}

function register() {
  ipcMain.handle('flapper:server-info', () => describe());
  ipcMain.handle('flapper:set-public', (_event, enabled) => setPublic(enabled));
}

function stop() {
  return server.stop(serverInfo);
}

module.exports = { init, register, start, restart, setPublic, describe, stop };
