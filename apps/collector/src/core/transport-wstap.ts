/**
 * Default transport: spawns the `wstap` Go binary (apps/collector/wstap),
 * which opens the websocket with Chrome's exact TLS and upgrade fingerprint
 * so Cloudflare's managed challenge lets it through. No browser involved.
 *
 * Protocol with the child: NDJSON {"t":ms,"d":"<frame>"} on stdout, one
 * frame per line on stdin for sends. Engine.IO ping/pong and the "40"
 * namespace connect are handled inside the binary. Exit codes: 4 = upgrade
 * refused (Cloudflare), 5 = read/send error, 6 = server closed.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Logger } from "pino";
import type { SiteAdapter } from "./adapter.js";
import { parsePairFrame, parseRawFrame, parseSocketIoFrame } from "./frames.js";
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
  const { url, path = "/socket.io/", protocol = "socketio" } = adapter.connection;
  /** Anything but Socket.IO: the upgrade itself is the connect, no Engine.IO handshake. */
  const raw = protocol !== "socketio";
  const wsUrl = new URL(url);
  if (!raw) {
    wsUrl.pathname = path;
    wsUrl.search = "?EIO=4&transport=websocket";
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

  function start() {
    if (closed) return;
    const args = ["-url", wsUrl.toString(), "-origin", origin];
    if (proxy) args.push("-proxy", proxy);
    child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    lastFrame = Date.now();
    seq = 0;
    log.info({ proxy: Boolean(proxy), session: proxy ? new URL(proxy).username.split("_session-")[1] ?? null : null }, "wstap spawned");

    createInterface({ input: child.stdout! }).on("line", (line) => {
      lastFrame = Date.now();
      let d: string;
      try {
        d = (JSON.parse(line) as { d: string }).d;
      } catch {
        return;
      }
      if (!raw && d.startsWith("40")) {
        if (refusals) log.info({ refusals }, "found a clean proxy exit");
        refusals = 0;
        setConnected(true);
        delay = 2_000;
        return;
      }
      const parsed = protocol === "pair" ? parsePairFrame(d) : raw ? parseRawFrame(d) : parseSocketIoFrame(d);
      if (parsed) hooks.onEvent({ event: parsed.event, args: parsed.args, receivedAt: new Date() });
    });
    createInterface({ input: child.stderr! }).on("line", (line) => {
      if (line.startsWith("connected:")) {
        log.info(line);
        if (raw) {
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
      const frame =
        protocol === "pair" ? JSON.stringify([event, args.length ? args[0] : null])
        : raw ? JSON.stringify([++seq, event, args[0]])
        : "42" + JSON.stringify([event, ...args]);
      child.stdin.write(frame + "\n");
    },
    close: async () => {
      closed = true;
      if (watchdog) clearInterval(watchdog);
      child?.kill("SIGTERM");
    },
  };
}
