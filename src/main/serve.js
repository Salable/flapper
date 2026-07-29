'use strict';

const { protocol } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEME = 'app';
const ORIGIN = `${SCHEME}://flapper`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Declare the scheme. Must run before `app` is ready.
 * A real scheme (rather than file://) lets the renderer use ES modules and
 * fetch() without tripping Chromium's file:// origin restrictions.
 */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** Serve the project directory over the scheme. Must run after `app` is ready. */
function serve() {
  protocol.handle(SCHEME, async (request) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const target = path.resolve(ROOT, '.' + pathname);
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const body = await fs.readFile(target);
      const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
      return new Response(body, { headers: { 'content-type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

module.exports = { registerScheme, serve, ORIGIN, ROOT };
