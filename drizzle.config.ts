import { defineConfig } from 'drizzle-kit'

// `drizzle-kit generate` writes a .sql migration from the schema below; that
// file is committed and `drizzle-kit migrate` replays it. We never run
// `drizzle-kit push` — push diffs the live database and rewrites it in place,
// which on real data means silently dropped tables and lost rows.
export default defineConfig({
  dialect: 'sqlite',
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dbCredentials: {
    url: process.env.DB_PATH || 'data/sank.db',
  },
})
