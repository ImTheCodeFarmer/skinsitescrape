import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export { encryptSecret, decryptSecret } from "./secrets.js";
export { formatAlert, roundUrlFor, ROUND_URLS, KIND_LABEL as ALERT_KIND_LABEL, SITE_NAMES as ALERT_SITE_NAMES, type AlertBet, type AlertKind } from "./alerts-format.js";
export { sql, eq, and, desc, gte, lt } from "drizzle-orm";

export type Db = ReturnType<typeof createDb>["db"];

/**
 * Mongo ObjectIds carry their creation time in the first 4 bytes. Rustypot
 * round ids are ObjectIds, and the hypertable keys on coinflips/jackpots
 * include created_at, so every writer derives created_at from the id this
 * way to keep upserts merging. Returns null for other id formats.
 */
export function objectIdTime(id: string): Date | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new Date(parseInt(id.slice(0, 8), 16) * 1000) : null;
}

export function createDb(url = process.env.DATABASE_URL, opts: { max?: number; connection?: Record<string, string | number | boolean> } = {}) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, {
    max: opts.max ?? 10,
    connection: opts.connection,
    idle_timeout: 30,
    prepare: false,
    transform: { undefined: null },
    // Timescale emits a NOTICE per already-fresh aggregate window; keep them out of the logs.
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return { db, client, close: () => client.end({ timeout: 5 }) };
}
