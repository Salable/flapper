'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * The shell remembers one thing: which board it shows. Kept in userData so a
 * kiosk machine boots straight back to its board.
 */

const FILE = 'settings.json';

function read(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(dir, patch) {
  const merged = { ...read(dir), ...patch };
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify(merged, null, 2));
  } catch (error) {
    // A shell that cannot persist still shows the board; say so and move on.
    console.error(`flapper: could not save settings - ${error.message}`);
  }
  return merged;
}

module.exports = { read, write };
