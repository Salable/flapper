import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './lib/db/schema.mjs',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Only needed by `drizzle-kit migrate`; `generate` never connects.
    url: process.env.DATABASE_URL ?? 'postgres://unused',
  },
});
