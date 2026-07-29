'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Server settings that have to outlive a launch.
 *
 * Just the network-access choice, so the control panel's Public toggle is a real
 * setting rather than something that resets on restart. Kept in the app's
 * user-data directory.
 */

const FILE = 'server-settings.json';

function filePath(userDataDir) {
  return path.join(userDataDir, FILE);
}

function read(userDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(userDataDir), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Missing or corrupt: fall back to defaults rather than failing to start.
    return {};
  }
}

function write(userDataDir, settings) {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(filePath(userDataDir), `${JSON.stringify(settings, null, 2)}\n`);
    return true;
  } catch (error) {
    console.error(`flapper: could not save server settings - ${error.message}`);
    return false;
  }
}

/** @returns {{publicAccess: boolean}} */
function load(userDataDir) {
  return { publicAccess: read(userDataDir).publicAccess === true };
}

function savePublicAccess(userDataDir, publicAccess) {
  return write(userDataDir, { ...read(userDataDir), publicAccess: Boolean(publicAccess) });
}

module.exports = { load, savePublicAccess, filePath };
