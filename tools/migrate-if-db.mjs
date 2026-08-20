#!/usr/bin/env node
/**
 * Run drizzle migrations at build time, but only when a real database is
 * configured. Build-time beats cold-start: no races across serverless
 * instances, and a failed migration fails the deploy where someone sees it.
 * Local builds and CI have no DATABASE_URL and skip straight through
 * (PGlite migrates itself programmatically in lib/db/client.mjs).
 */

import { execFileSync } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.log('migrate: no DATABASE_URL, skipping (PGlite migrates on boot)');
  process.exit(0);
}

console.log('migrate: applying drizzle migrations');
execFileSync('npx', ['drizzle-kit', 'migrate'], { stdio: 'inherit' });
