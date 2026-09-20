import { createDb } from "@casino/db";
import { ADAPTERS, adaptersFor } from "./adapters/index.js";
import { connectSocketIo } from "./core/transport.js";
import { connectBrowser } from "./core/transport-browser.js";
import { connectWstap } from "./core/transport-wstap.js";
import { Sink } from "./core/sink.js";
import { Alerts } from "./core/alerts.js";
import { StatusReporter } from "./core/status.js";
import { log } from "./core/log.js";

const sites = (process.env.SITES ?? "rustypot").split(",").map((s) => s.trim()).filter(Boolean);
const proxyUrl = process.env.PROXY_URL || undefined;
const transportKind = (["socketio", "browser", "wstap"].includes(process.env.TRANSPORT ?? "") ? process.env.TRANSPORT : "wstap") as "socketio" | "browser" | "wstap";
const connect = { socketio: connectSocketIo, browser: connectBrowser, wstap: connectWstap }[transportKind];
const { db, close } = createDb();
const alerts = new Alerts(db);
const sink = new Sink(db, { recordRaw: process.env.RECORD_RAW !== "false", onBets: (b) => alerts.onBets(b) });

const running = sites.flatMap((site) => {
  const adapters = adaptersFor(site);
  if (!adapters.length) throw new Error(`unknown site "${site}" (known: ${Object.keys(ADAPTERS).join(", ")})`);
  // One status row per site, shared by all of its connections.
  const status = new StatusReporter(db, site, adapters.length);
  return adapters.map((adapter, conn) => {
    const slog = log.child(adapter.feed ? { site, feed: adapter.feed } : { site });
    const transport = connect(
      adapter,
      {
        onConnect: () => {
          status.onConnect(conn);
          adapter.onConnect?.({ sink, log: slog, emit: (e, ...a) => transport.emit(e, ...a) });
        },
        onDisconnect: (r) => status.onDisconnect(r, conn),
        onError: (m) => status.onError(m),
        onEvent: (evt) => {
          status.onEvent();
          try {
            const r = adapter.handle(evt, { sink, log: slog, emit: (e, ...a) => transport.emit(e, ...a) });
            if (r instanceof Promise) r.catch((err) => slog.error({ err, event: evt.event }, "handler failed"));
          } catch (err) {
            slog.error({ err, event: evt.event }, "handler threw");
          }
        },
      },
      slog,
      proxyUrl,
    );
    return { transport, status };
  });
});

log.info({ sites, proxy: Boolean(proxyUrl), transport: transportKind }, "collector started");

async function shutdown(signal: string) {
  log.info({ signal }, "shutting down");
  await Promise.all(running.map((r) => r.transport.close()));
  await Promise.all([...new Set(running.map((r) => r.status))].map((s) => s.close()));
  await sink.close();
  await alerts.close();
  await close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
