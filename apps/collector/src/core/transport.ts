/**
 * Socket.IO (Engine.IO v4) transport with optional HTTP proxy. Reconnects with
 * capped exponential backoff and hands every server event to the adapter.
 *
 * If a site fronts its socket with Cloudflare bot protection, Node's TLS
 * fingerprint may be rejected (HTTP 403 on the upgrade). In that case swap
 * this transport for a headless-browser one; the adapter interface is the
 * same, so nothing downstream changes.
 */
import { io, type Socket } from "socket.io-client";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { Logger } from "pino";
import type { SiteAdapter, IncomingEvent } from "./adapter.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export type TransportHooks = {
  onEvent: (evt: IncomingEvent) => void;
  onConnect: () => void;
  onDisconnect: (reason: string) => void;
  onError: (msg: string) => void;
};

export type Transport = {
  emit: (event: string, ...args: unknown[]) => void;
  close: () => Promise<void> | void;
};

export function connectSocketIo(adapter: SiteAdapter, hooks: TransportHooks, log: Logger, proxyUrl?: string): Transport {
  const socket = connectRaw(adapter, hooks, log, proxyUrl);
  return { emit: (e, ...a) => void socket.emit(e, ...a), close: () => void socket.close() };
}

export function connectRaw(adapter: SiteAdapter, hooks: TransportHooks, log: Logger, proxyUrl?: string): Socket {
  const { url, path = "/socket.io/", headers = {} } = adapter.connection;
  const origin = new URL(url).origin.replace(/^ws/, "http");
  const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

  const socket = io(url, {
    path,
    transports: ["websocket"],
    agent: agent as unknown as string | undefined,
    reconnection: true,
    reconnectionDelay: 2_000,
    reconnectionDelayMax: 60_000,
    randomizationFactor: 0.4,
    timeout: 20_000,
    extraHeaders: { Origin: origin, "User-Agent": UA, ...headers },
  });

  socket.on("connect", () => {
    log.info({ id: socket.id, proxy: Boolean(proxyUrl) }, "connected");
    hooks.onConnect();
  });
  socket.on("disconnect", (reason) => {
    log.warn({ reason }, "disconnected");
    hooks.onDisconnect(reason);
  });
  socket.on("connect_error", (err) => {
    const desc = (err as { description?: { status?: number } }).description;
    const msg = desc?.status ? `${err.message} (HTTP ${desc.status})` : err.message;
    log.error({ error: msg }, "connect_error");
    hooks.onError(msg);
  });
  socket.onAny((event: string, ...args: unknown[]) => {
    hooks.onEvent({ event, args, receivedAt: new Date() });
  });

  return socket;
}
