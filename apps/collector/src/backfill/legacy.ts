import postgres from "postgres";
import type { Legacy } from "./types.js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

/**
 * One read-only connection to the legacy scraper's Postgres. Every query is a
 * primary-key range scan or an indexed `= ANY(ids)` lookup, so a single
 * connection with a statement timeout is all the load it ever sees.
 */
export function connectLegacy(): Legacy {
  return postgres({
    host: need("LEGACY_DB_HOST"),
    port: Number(process.env.LEGACY_DB_PORT ?? 5432),
    database: need("LEGACY_DB_NAME"),
    username: need("LEGACY_DB_USER"),
    password: need("LEGACY_DB_PASSWORD"),
    ssl: process.env.LEGACY_DB_SSL === "true" ? ("require" as const) : false,
    max: 1,
    prepare: false,
    idle_timeout: 120,
    connect_timeout: 20,
    connection: {
      application_name: "casino-backfill",
      default_transaction_read_only: true,
      statement_timeout: 300_000,
    },
    onnotice: () => {},
  });
}
