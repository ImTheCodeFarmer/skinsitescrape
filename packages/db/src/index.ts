import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export { sql, eq, and, desc, gte, lt } from "drizzle-orm";

export type Db = ReturnType<typeof createDb>["db"];

export function createDb(url = process.env.DATABASE_URL, opts: { max?: number } = {}) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, {
    max: opts.max ?? 10,
    idle_timeout: 30,
    prepare: false,
    transform: { undefined: null },
    // Timescale emits a NOTICE per already-fresh aggregate window; keep them out of the logs.
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return { db, client, close: () => client.end({ timeout: 5 }) };
}
