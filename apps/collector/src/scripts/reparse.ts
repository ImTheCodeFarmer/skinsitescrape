/**
 * Replay raw_events through the current adapter code. Use after fixing a
 * parser so historical rows get re-derived. Idempotent.
 *
 *   pnpm reparse rustypot [sinceISO]
 */
import { createDb, sql } from "@casino/db";
import { adaptersFor } from "../adapters/index.js";
import { Sink } from "../core/sink.js";
import { log } from "../core/log.js";

const site = process.argv[2] ?? "rustypot";
const since = process.argv[3] ? new Date(process.argv[3]) : new Date(0);
const adapters = adaptersFor(site);
if (!adapters.length) throw new Error(`unknown site ${site}`);

// postgres.js with prepare=false cannot serialize Date or BigInt params, so both go over as strings.
const { db, close } = createDb();
const sink = new Sink(db, { recordRaw: false });
const ctx = { sink, log, emit: () => {} };

let lastId = 0n;
let n = 0;
for (;;) {
  const rows = (await db.execute(sql`
    SELECT id, event, payload, received_at FROM raw_events
    WHERE site = ${site} AND received_at >= ${since.toISOString()}::timestamptz AND id > ${lastId.toString()}::bigint
    ORDER BY id LIMIT 2000`)) as unknown as { id: string; event: string; payload: unknown; received_at: Date }[];
  if (!rows.length) break;
  for (const r of rows) {
    lastId = BigInt(r.id);
    const args = Array.isArray(r.payload) ? r.payload : [r.payload];
    // Every adapter of the site sees every row; each ignores the events it does not own.
    for (const adapter of adapters) {
      try {
        await adapter.handle({ event: r.event, args, receivedAt: new Date(r.received_at) }, ctx);
      } catch (err) {
        log.error({ err, id: r.id, feed: adapter.feed }, "reparse failed");
      }
    }
  }
  n += rows.length;
  await sink.flush();
  log.info({ n }, "reparsed");
}
await sink.close();
await close();
