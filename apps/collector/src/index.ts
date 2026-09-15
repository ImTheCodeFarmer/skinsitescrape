import { createDb } from "@casino/db";
import { ADAPTERS } from "./adapters/index.js";
import { connectSocketIo } from "./core/transport.js";
import { connectBrowser } from "./core/transport-browser.js";
import { connectWstap } from "./core/transport-wstap.js";
import { Sink } from "./core/sink.js";
import { StatusReporter } from "./core/status.js";
import { log } from "./core/log.js";

const sites = (process.env.SITES ?? "rustypot").split(",").map((s) => s.trim()).filter(Boolean);
const proxyUrl = process.env.PROXY_URL || undefined;
const transportKind = (["socketio", "browser", "wstap"].includes(process.env.TRANSPORT ?? "") ? process.env.TRANSPORT : "wstap") as "socketio" | "browser" | "wstap";
const connect = { socketio: connectSocketIo, browser: connectBrowser, wstap: connectWstap }[transportKind];
const { db, close } = createDb();
const sink = new Sink(db, { recordRaw: process.env.RECORD_RAW !== "false" });

const running = sites.map((site) => {
  const adapter = ADAPTERS[site];
  if (!adapter) throw new Error(`unknown site "${site}" (known: ${Object.keys(ADAPTERS).join(", ")})`);
  const slog = log.child({ site });
  const status = new StatusReporter(db, site);
  const transport = connect(
    adapter,
    {
      onConnect: () => {
        status.onConnect();
        adapter.onConnect?.({ sink, log: slog, emit: (e, ...a) => transport.emit(e, ...a) });
      },
      onDisconnect: (r) => status.onDisconnect(r),
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

log.info({ sites, proxy: Boolean(proxyUrl), transport: transportKind }, "collector started");

async function shutdown(signal: string) {
  log.info({ signal }, "shutting down");
  await Promise.all(running.map((r) => r.transport.close()));
  await Promise.all(running.map((r) => r.status.close()));
  await sink.close();
  await close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
