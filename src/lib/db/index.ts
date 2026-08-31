import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_DIR = resolve(process.cwd(), "drizzle");

/**
 * Open a database and bring it up to date.
 *
 * Pass ":memory:" for tests — every test gets a real SQLite engine with the
 * real schema, so nothing here needs mocking.
 */
export function createDatabase(url: string): Db {
  if (url !== ":memory:") {
    mkdirSync(dirname(resolve(url)), { recursive: true });
  }

  const sqlite = new Database(url);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  if (existsSync(MIGRATIONS_DIR)) {
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }
  return db;
}

/**
 * Process-wide handle. Cached on globalThis so Next.js hot reloads reuse one
 * connection instead of leaking a file handle per edit.
 */
const globalForDb = globalThis as unknown as { cbapDb?: Db };

export const db: Db =
  globalForDb.cbapDb ?? (globalForDb.cbapDb = createDatabase(process.env.CBAP_DB_PATH ?? "data/cbap.db"));

export { schema };
