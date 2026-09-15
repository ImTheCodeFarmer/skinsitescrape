import "server-only";
import { createDb } from "@casino/db";

const g = globalThis as unknown as { __casinoDb?: ReturnType<typeof createDb> };

/** One connection pool per process, survives Next's dev reloads. */
export function db() {
  if (!g.__casinoDb) g.__casinoDb = createDb();
  return g.__casinoDb.db;
}
