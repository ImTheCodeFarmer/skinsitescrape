/**
 * Default transport: spawns the `wstap` Go binary (apps/collector/wstap),
 * which opens the websocket with Chrome's exact TLS and upgrade fingerprint
 * so Cloudflare's managed challenge lets it through. No browser involved.
 *
 * Protocol with the child: NDJSON {"t":ms,"d":"<frame>"} on stdout, one
 * frame per line on stdin for sends. Engine.IO ping/pong and the "40"
 * namespace connect are handled inside the binary; the graphql-transport-ws
 * handshake and keepalive are handled here. Exit codes: 4 = upgrade
 * refused (Cloudflare), 5 = read/send error, 6 = server closed.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Logger } from "pino";
import type { SiteAdapter } from "./adapter.js";
import { parseEnvelopeFrame, parseGraphqlFrame, parseMsgpackPacket, parsePairFrame, parseRawFrame, parseSocketIoFrame } from "./frames.js";
import { decode as mpDecode, encode as mpEncode } from "./msgpack.js";
import type { TransportHooks, Transport } from "./transport.js";

function findBinary(): string {
  if (process.env.WSTAP_PATH) return process.env.WSTAP_PATH;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, "..", "..", "wstap", "wstap"), join(here, "..", "..", "..", "wstap", "wstap"), "/usr/local/bin/wstap"]) {
    if (existsSync(p)) return p;
  }
  throw new Error("wstap binary not found: build it with `pnpm --filter collector build:wstap` or set WSTAP_PATH");
}

/**
 * Residential pools hand out exits of mixed reputation; Cloudflare challenges
 * most of them and passes some (roughly 1 in 6 on the "low" pool). A sticky
 * session (`<user>_session-<id>`) pins one exit, so the strategy is to hunt:
 * try a fresh session id on every refusal, keep the one that connects, and
 * hunt again only after the connection drops. An established websocket stays
 * on its tunnel even if the session's IP would rotate for new connections.
 */
export function stickyProxy(proxyUrl: string | undefined, site: string, attempt = 0): string | undefined {
  if (!proxyUrl || process.env.PROXY_STICKY === "false") return proxyUrl;
  const u = new URL(proxyUrl);
  if (/_session-/.test(u.username)) return proxyUrl; // caller pinned a session explicitly
  u.username = `${u.username}_session-${site}${attempt}${Math.random().toString(36).slice(2, 7)}`;
  return u.toString();
}

const HUNT_MAX = Number(process.env.PROXY_HUNT_MAX ?? 40); // refusals in a row before a long pause

export function connectWstap(adapter: SiteAdapter, hooks: TransportHooks, log: Logger, proxyUrl?: string): Transport {
  const bin = findBinary();
  const { url, path = "/socket.io/", protocol = "socketio", query = {} } = adapter.connection;
  /** Anything but Socket.IO: no Engine.IO handshake. The upgrade itself is the connect, except for graphql, which waits for its own ack. */
  const msgpack = protocol === "socketio-msgpack";
  const raw = protocol !== "socketio" && !msgpack;
  const graphql = protocol === "graphql";
  const wsUrl = new URL(url);
  if (!raw) {
    wsUrl.pathname = path;
    wsUrl.search = new URLSearchParams({ ...query, EIO: "4", transport: "websocket" }).toString();
  }
  const origin = (adapter.connection.pageUrl ? new URL(adapter.connection.pageUrl).origin : wsUrl.origin).replace(/^ws/, "http");
  let hunting = Boolean(proxyUrl) && process.env.PROXY_STICKY !== "false" && !/_session-/.test(new URL(proxyUrl!).username);
  let refusals = 0;
  let proxy = stickyProxy(proxyUrl, adapter.site, 0);

  let child: ChildProcess | null = null;
  let closed = false;
  let connected = false;
  let delay = 2_000;
  let lastFrame = 0;
  let watchdog: NodeJS.Timeout | null = null;
  /** graphql-transport-ws keepalive; the server answers with a pong, which also feeds the watchdog. */
  let keepalive: NodeJS.Timeout | null = null;
  /** Request id for the raw protocol; the server echoes it on the reply. */
  let seq = 0;

  const setConnected = (v: boolean, reason = "") => {
    if (v && !connected) {
      connected = true;
      hooks.onConnect();
    } else if (!v && connected) {
      connected = false;
      hooks.onDisconnect(reason);
    }
  };

  /** Socket.IO packet as socket.io-msgpack-parser frames it, sent as one binary websocket message. */
  const sendBinary = (packet: unknown) => child?.stdin?.write("b:" + mpEncode(packet).toString("base64") + "\n");

  function start() {
    if (closed) return;
    const args = ["-url", wsUrl.toString(), "-origin", origin];
    if (graphql) args.push("-subprotocol", "graphql-transport-ws");
    if (msgpack) args.push("-binary");
    if (proxy) args.push("-proxy", proxy);
    child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    lastFrame = Date.now();
    seq = 0;
    log.info({ proxy: Boolean(proxy), session: proxy ? new URL(proxy).username.split("_session-")[1] ?? null : null }, "wstap spawned");

    createInterface({ input: child.stdout! }).on("line", (line) => {
      lastFrame = Date.now();
      let d: string;
      let b: string | undefined;
      try {
        ({ d, b } = JSON.parse(line) as { d: string; b?: string });
      } catch {
        return;
      }
      if (msgpack) {
        if (b === undefined) {
          // Text frames in msgpack mode are Engine.IO only: the handshake opens the namespace with our own, msgpack-encoded CONNECT.
          if (typeof d === "string" && d.startsWith("0{")) sendBinary({ type: 0, data: { token: null }, nsp: "/" });
          return;
        }
        let packet: ReturnType<typeof parseMsgpackPacket>;
        try {
          packet = parseMsgpackPacket(mpDecode(Buffer.from(b, "base64")));
        } catch (err) {
          log.warn({ err }, "undecodable msgpack frame");
          return;
        }
        if (!packet) return;
        if (packet.event === "connect") {
          if (refusals) log.info({ refusals }, "found a clean proxy exit");
          refusals = 0;
          setConnected(true);
          delay = 2_000;
          return;
        }
        if (packet.event === "connect_error") {
          log.warn({ data: packet.args[0] }, "socket.io connect_error");
          hooks.onError("connect_error");
          return;
        }
        hooks.onEvent({ event: packet.event, args: packet.args, receivedAt: new Date() });
        return;
      }
      if (!raw && d.startsWith("40")) {
        if (refusals) log.info({ refusals }, "found a clean proxy exit");
        refusals = 0;
        setConnected(true);
        delay = 2_000;
        return;
      }
      const parsed =
        graphql ? parseGraphqlFrame(d)
        : protocol === "envelope" ? parseEnvelopeFrame(d)
        : protocol === "pair" ? parsePairFrame(d)
        : raw ? parseRawFrame(d)
        : parseSocketIoFrame(d);
      if (!parsed) return;
      if (graphql) {
        // The protocol's own control messages never reach the adapter.
        if (parsed.event === "connection_ack") {
          if (refusals) log.info({ refusals }, "found a clean proxy exit");
          refusals = 0;
          setConnected(true);
          delay = 2_000;
          return;
        }
        if (parsed.event === "ping") return void child?.stdin?.write(JSON.stringify({ type: "pong" }) + "\n");
        if (parsed.event === "pong") return;
      }
      hooks.onEvent({ event: parsed.event, args: parsed.args, receivedAt: new Date() });
    });
    createInterface({ input: child.stderr! }).on("line", (line) => {
      if (line.startsWith("connected:")) {
        log.info(line);
        if (graphql) {
          // Open the graphql-transport-ws session; connection_ack completes the connect.
          child?.stdin?.write(JSON.stringify({ type: "connection_init", payload: {} }) + "\n");
          keepalive = setInterval(() => child?.stdin?.write(JSON.stringify({ type: "ping" }) + "\n"), 30_000);
          keepalive.unref();
        } else if (raw) {
          // No namespace handshake on a raw socket: the upgrade itself is the connect.
          if (refusals) log.info({ refusals }, "found a clean proxy exit");
          refusals = 0;
          setConnected(true);
          delay = 2_000;
        }
      } else {
        log.warn({ wstap: line }, "wstap");
        hooks.onError(line);
      }
    });
    child.on("exit", (code, signal) => {
      child = null;
      if (watchdog) clearInterval(watchdog);
      watchdog = null;
      if (keepalive) clearInterval(keepalive);
      keepalive = null;
      setConnected(false, `wstap exited code=${code} signal=${signal}`);
      if (closed) return;
      let wait: number;
      if (code === 4 && hunting) {
        // Cloudflare refused this exit: move to a fresh sticky session right away.
        refusals += 1;
        proxy = stickyProxy(proxyUrl, adapter.site, refusals);
        wait = refusals % HUNT_MAX === 0 ? 300_000 : 1_500;
        if (wait > 5_000) log.warn({ refusals }, "no clean exit found, pausing 5 min");
      } else if (code === 4) {
        // Refused on a fixed IP. Hammering lowers its reputation further, so back off 30s up to 10 min.
        delay = Math.max(delay, 30_000);
        wait = delay;
        delay = Math.min(delay * 2, 600_000);
      } else {
        wait = delay;
        delay = Math.min(delay * 2, 60_000);
      }
      log.warn({ code, signal, retryMs: wait }, "wstap exited, restarting");
      setTimeout(start, wait);
    });

    watchdog = setInterval(() => {
      if (child && Date.now() - lastFrame > 90_000) {
        log.warn("no frames for 90s, restarting wstap");
        child.kill("SIGTERM");
      }
    }, 15_000);
    watchdog.unref();
  }

  start();

  return {
    emit: (event, ...args) => {
      if (!child?.stdin?.writable) return;
      if (msgpack) return void sendBinary({ type: 2, data: [event, ...args], options: { compress: true }, nsp: "/" });
      const frame =
        graphql ? JSON.stringify({ id: event, type: "subscribe", payload: { query: args[0], variables: args[1] ?? {} } })
        : protocol === "envelope" ? JSON.stringify({ a: [event, ...args], i: ++seq })
        : protocol === "pair" ? JSON.stringify([event, args.length ? args[0] : null])
        : raw ? JSON.stringify([++seq, event, args[0]])
        : "42" + JSON.stringify([event, ...args]);
      child.stdin.write(frame + "\n");
    },
    close: async () => {
      closed = true;
      if (watchdog) clearInterval(watchdog);
      if (keepalive) clearInterval(keepalive);
      child?.kill("SIGTERM");
    },
  };
}
