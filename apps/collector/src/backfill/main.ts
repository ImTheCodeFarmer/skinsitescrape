/**
 * Import the legacy scraper's history into this database, keeping this
 * schema. Resumable: each legacy source keeps its cursor in
 * backfill_progress, and every write is the same idempotent upsert the live
 * collector uses, so a crash, Ctrl-C or re-run only repeats the last batch.
 *
 *   pnpm --filter collector backfill                 # everything in the default set, then refresh aggregates
 *   pnpm --filter collector backfill -- --list       # sources and saved progress
 *   pnpm --filter collector backfill -- --sources rustypot --max-batches 5 --dry-run
 *   pnpm --filter collector backfill -- --refresh-caggs
 *   pnpm --filter collector backfill -- --sources rustypot --from 2100000   # re-walk from a legacy id (saved cursor untouched)
 *
 * A failed write stops the run with the cursor left before the failed batch,
 * so a rerun retries exactly the rows that were dropped.
 *
 * Env: DATABASE_URL (target), LEGACY_DB_HOST/NAME/USER/PASSWORD (+ optional
 * LEGACY_DB_PORT, LEGACY_DB_SSL=true), BACKFILL_BATCH, BACKFILL_PAUSE_MS,
 * BACKFILL_TAIL_MINUTES, BACKFILL_USD_<SITE>, BACKFILL_ROULETTE_WHEEL.
 */
import { createDb } from "@casino/db";
import { Sink } from "../core/sink.js";
import { log } from "../core/log.js";
import { connectLegacy } from "./legacy.js";
import { listProgress, resetProgress, runSource, type RunOptions } from "./runner.js";
import { refreshAggregates } from "./caggs.js";
import { DEFAULT_SOURCES, SOURCES } from "./sources/index.js";
import { usdPerUnit } from "./config.js";

type Args = RunOptions & { sources: string[]; list: boolean; reset: boolean; refreshOnly: boolean; noRefresh: boolean };

function parseArgs(argv: string[]): Args {
  const envNum = (k: string, d: number) => (process.env[k] && Number.isFinite(Number(process.env[k])) ? Number(process.env[k]) : d);
  const a: Args = {
    sources: [],
    batch: envNum("BACKFILL_BATCH", 1000),
    pauseMs: envNum("BACKFILL_PAUSE_MS", 250),
    tailMinutes: envNum("BACKFILL_TAIL_MINUTES", 15),
    maxBatches: 0,
    dryRun: false,
    until: null,
    from: null,
    list: false,
    reset: false,
    refreshOnly: false,
    noRefresh: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--") continue;
    if (k === "--sources") a.sources = v().split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--batch") a.batch = Number(v());
    else if (k === "--pause") a.pauseMs = Number(v());
    else if (k === "--tail") a.tailMinutes = Number(v());
    else if (k === "--max-batches") a.maxBatches = Number(v());
    else if (k === "--until") a.until = new Date(v());
    else if (k === "--from") a.from = BigInt(v());
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--list") a.list = true;
    else if (k === "--reset") a.reset = true;
    else if (k === "--refresh-caggs") a.refreshOnly = true;
    else if (k === "--no-refresh") a.noRefresh = true;
    else throw new Error(`unknown argument ${k}`);
  }
  if (a.until && Number.isNaN(a.until.getTime())) throw new Error("--until must be an ISO timestamp");
  if (!(a.batch > 0 && a.batch <= 5000)) throw new Error("--batch must be 1..5000");
  return a;
}

const args = parseArgs(process.argv.slice(2));
const byName = new Map(SOURCES.map((s) => [s.name, s]));
const wanted = args.sources.length ? args.sources : DEFAULT_SOURCES;
for (const n of wanted) if (!byName.has(n)) throw new Error(`unknown source "${n}" (known: ${SOURCES.map((s) => s.name).join(", ")})`);

// Replays can upsert into chunks the compression policies have already
// compressed; lift TimescaleDB's per-transaction decompression cap for this session.
const { db, close } = createDb(process.env.DATABASE_URL, { max: 2, connection: { "timescaledb.max_tuples_decompressed_per_dml_transaction": 0 } });

if (args.list) {
  const progress = new Map((await listProgress(db)).map((p) => [String(p.source), p]));
  for (const s of SOURCES) {
    const p = progress.get(s.name);
    const flag = s.optIn ? " (opt-in)" : "";
    const state = p
      ? `cursor=${p.cursor} rows=${p.rows_read} updated=${new Date(p.updated_at as string).toISOString()}${p.caught_up_at ? " caught-up" : ""}`
      : "not started";
    console.log(`${s.name.padEnd(20)} ${s.site.padEnd(11)} <- ${s.table.padEnd(32)} ${state}${flag}${s.note ? `\n${"".padEnd(20)} note: ${s.note}` : ""}`);
  }
  console.log(`\nUSD per legacy unit: ${[...new Set(SOURCES.map((s) => s.site))].map((s) => `${s}=${usdPerUnit(s)}`).join("  ")}`);
  await close();
  process.exit(0);
}

if (args.reset) {
  if (!args.sources.length) throw new Error("--reset needs an explicit --sources list");
  await resetProgress(db, args.sources);
  log.warn({ sources: args.sources }, "progress reset; rows already imported stay (upserts are idempotent)");
}

let stop = false;
const onSignal = (sig: string) => {
  if (stop) process.exit(130);
  log.warn({ sig }, "finishing current batch, then stopping (send again to abort)");
  stop = true;
};
process.on("SIGINT", () => onSignal("SIGINT"));
process.on("SIGTERM", () => onSignal("SIGTERM"));

const sink = new Sink(db, { recordRaw: false, dryRun: args.dryRun });
// Refresh-only runs never touch the legacy database.
const legacy = args.refreshOnly ? null : connectLegacy();
let allDone = true;

try {
  if (!args.refreshOnly) {
    log.info({ sources: wanted, batch: args.batch, pauseMs: args.pauseMs, tailMinutes: args.tailMinutes, dryRun: args.dryRun, until: args.until }, "backfill starting");
    for (const name of wanted) {
      if (stop) break;
      const done = await runSource(byName.get(name)!, args, { legacy: legacy!, db, sink, log, stopRequested: () => stop });
      allDone &&= done;
    }
    await sink.close();
    log.info({ written: sink.counts, dryRun: args.dryRun }, "backfill finished");
  }
  if ((args.refreshOnly || (allDone && !args.noRefresh && !args.dryRun && !args.maxBatches)) && !stop) {
    log.info("refreshing continuous aggregates over the imported range");
    await refreshAggregates(db, log, { pauseMs: Math.max(args.pauseMs, 500) });
  } else if (!args.refreshOnly) {
    log.info("aggregates not refreshed (run with --refresh-caggs once every source has caught up)");
  }
} finally {
  await sink.close();
  await legacy?.end({ timeout: 5 });
  await close();
}
process.exit(stop && !allDone ? 130 : 0);
