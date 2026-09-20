/**
 * Run Steam profile enrichment passes by hand, e.g. to backfill after
 * enabling it:  pnpm --filter collector steam-enrich 20   (passes of STEAM_BATCH profiles each)
 */
import { createDb } from "@casino/db";
import { log } from "../core/log.js";
import { SteamEnricher } from "@casino/db/steam-enrich";
const passes = Number(process.argv[2] ?? 1);
const { db, close } = createDb();
const e = new SteamEnricher(db, log);
let total = 0;
for (let i = 0; i < passes; i++) {
  const n = await e.runOnce();
  total += n;
  console.log(`pass ${i + 1}: ${n} profiles`);
  if (!n) break;
}
console.log(`done, ${total} profiles`);
await e.close();
await close();
