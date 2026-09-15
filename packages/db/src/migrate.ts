/**
 * Minimal forward-only SQL migrator. Applies migrations/*.sql in name order
 * and records each in _migrations. Drizzle-kit can't express hypertables or
 * continuous aggregates, so the schema lives in plain SQL.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const sql = postgres(url, { max: 1, onnotice: () => {} });

await sql`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
const applied = new Set((await sql`SELECT name FROM _migrations`).map((r) => r.name as string));

for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(file)) continue;
  const body = readFileSync(join(dir, file), "utf8");
  process.stdout.write(`applying ${file} ... `);
  // Continuous aggregates cannot run inside a transaction, so each file runs
  // as a plain multi-statement script.
  await sql.unsafe(body);
  await sql`INSERT INTO _migrations (name) VALUES (${file})`;
  console.log("ok");
}
await sql.end();
console.log("migrations up to date");
