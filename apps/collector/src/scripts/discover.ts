/**
 * Connect to a site for N seconds, tally every event name and save up to
 * three samples of each to ./discover/<site>.json. No database needed.
 *
 *   PROXY_URL=... pnpm discover rustypot 180        (wstap transport, default)
 *   TRANSPORT=browser pnpm discover rustypot 180    (headed Chrome fallback)
 *   TRANSPORT=socketio pnpm discover rustypot 180   (plain socket.io client)
 */
import { mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import { ADAPTERS } from "../adapters/index.js";
import { connectSocketIo } from "../core/transport.js";
import { connectBrowser } from "../core/transport-browser.js";
import { connectWstap } from "../core/transport-wstap.js";
import { log } from "../core/log.js";

const site = process.argv[2] ?? "rustypot";
const seconds = Number(process.argv[3] ?? 120);
const adapter = ADAPTERS[site];
if (!adapter) throw new Error(`unknown site ${site}`);

mkdirSync("discover", { recursive: true });
const ndjson = createWriteStream(`discover/${site}.ndjson`, { flags: "a" });
const counts = new Map<string, number>();
const samples = new Map<string, unknown[]>();

const connect = process.env.TRANSPORT === "socketio" ? connectSocketIo : process.env.TRANSPORT === "browser" ? connectBrowser : connectWstap;
const socket = connect(
  adapter,
  {
    onConnect: () => adapter.onConnect?.({ sink: null as never, log, emit: (e, ...a) => socket.emit(e, ...a) }),
    onDisconnect: () => {},
    onError: () => {},
    onEvent: ({ event, args, receivedAt }) => {
      counts.set(event, (counts.get(event) ?? 0) + 1);
      const s = samples.get(event) ?? [];
      if (s.length < 3) s.push(args.length === 1 ? args[0] : args);
      samples.set(event, s);
      ndjson.write(JSON.stringify({ t: receivedAt.toISOString(), event, args }) + "\n");
    },
  },
  log,
  process.env.PROXY_URL || undefined,
);

setTimeout(() => {
  console.log(`\n== ${site}: events seen in ${seconds}s ==`);
  for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(6), k);
  writeFileSync(`discover/${site}.json`, JSON.stringify(Object.fromEntries(samples), null, 2));
  console.log(`samples -> discover/${site}.json, full stream -> discover/${site}.ndjson`);
  socket.close();
  process.exit(0);
}, seconds * 1000);
