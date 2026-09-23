/**
 * Minimal forward-only SQL migrator. Applies migrations/*.sql in name order
 * and records each in _migrations. Drizzle-kit can't express hypertables or
 * continuous aggregates, so the schema lives in plain SQL.
 *
 * DDL waits for its lock with a timeout and retries, instead of sitting in
 * the lock queue. A waiting ALTER TABLE blocks every later query on that
 * table, so an ALTER queued behind one long transaction stalled the whole
 * dashboard for eight minutes on 2026-09-22 (and the collector, which
 * starts after this). With the timeout the table is usable between tries.
 * Files must be idempotent (IF NOT EXISTS) since a failed try rolls back
 * the whole file.
 *
 * It runs twice per deploy: as the web service's Railway pre-deploy command
 * (so new pages never go live against an old schema) and on collector boot.
 * A session advisory lock makes concurrent runs take turns; the second one
 * then finds everything applied.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const sql = postgres(url, { max: 1, onnotice: () => {} });
const LOCK_TIMEOUT = process.env.MIGRATE_LOCK_TIMEOUT ?? "5s";
const RETRY_FOR_MS = Number(process.env.MIGRATE_RETRY_MINUTES ?? 15) * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Arbitrary constant key shared by every run of this migrator. No lock_timeout is set yet, so this waits for another run to finish.
const ADVISORY_KEY = 7271801;
await sql`SELECT pg_advisory_lock(${ADVISORY_KEY})`;

await sql`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
const applied = new Set((await sql`SELECT name FROM _migrations`).map((r) => r.name as string));

for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(file)) continue;
  const body = readFileSync(join(dir, file), "utf8");
  process.stdout.write(`applying ${file} ... `);
  await sql.unsafe(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
  const until = Date.now() + RETRY_FOR_MS;
  for (let attempt = 1; ; attempt++) {
    try {
      // Continuous aggregates cannot run inside a transaction, so each file runs
      // as a plain multi-statement script.
      await sql.unsafe(body);
      break;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      // 55P03 lock_not_available: something holds a conflicting lock; back off and try again.
      if (e.code !== "55P03" || Date.now() > until) throw err;
      process.stdout.write(`\n  waiting for lock (attempt ${attempt}: ${e.message}) ... `);
      await sleep(3_000);
    }
  }
  await sql`INSERT INTO _migrations (name) VALUES (${file}) ON CONFLICT DO NOTHING`;
  console.log("ok");
}
await sql`SELECT pg_advisory_unlock(${ADVISORY_KEY})`;
await sql.end();
console.log("migrations up to date");
