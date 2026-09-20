import type { Sink } from "./sink.js";
import type { Logger } from "pino";

export type IncomingEvent = { event: string; args: unknown[]; receivedAt: Date };

export type AdapterContext = {
  sink: Sink;
  log: Logger;
  /** Send a message back over the socket (e.g. subscribe requests). */
  emit: (event: string, ...args: unknown[]) => void;
};

export interface SiteAdapter {
  site: string;
  /** Socket.IO connection details. */
  connection: {
    url: string;
    path?: string;
    /** Extra query parameters on the Engine.IO URL (rusteasy wants `userStatus=guest`). */
    query?: Record<string, string>;
    /** Extra headers sent on the upgrade request. */
    headers?: Record<string, string>;
    /** Page to load in the browser transport. Defaults to the site origin. */
    pageUrl?: string;
    /**
     * Wire protocol. "socketio" (default) appends the Engine.IO path and
     * query and frames events as "42[...]". "raw" connects to `url` verbatim
     * and frames as JSON arrays `[id, event, data]` (csgogem). "pair" also
     * connects verbatim and frames as `[event, data]` with no request ids
     * (cases.gg). "envelope" connects verbatim too and frames as objects,
     * `{"a":[event, ...args], "i":id}` with replies `{"i":id, "d":data}`
     * (bandit.camp). "graphql" connects verbatim with the
     * `graphql-transport-ws` subprotocol, sends `connection_init` and counts
     * the `connection_ack` as the connect; `emit(name, query, variables)`
     * subscribes with `name` as the message id, so every `next` for it
     * arrives as event `name` with the payload's `data` (csgoroll).
     * "socketio-msgpack" is Socket.IO with socket.io-msgpack-parser: the
     * Engine.IO handshake and pings stay text, every Socket.IO packet is a
     * binary MessagePack object (rustbattle). Only the wstap transport
     * speaks "raw", "pair", "envelope", "graphql" and "socketio-msgpack".
     */
    protocol?: "socketio" | "socketio-msgpack" | "raw" | "pair" | "envelope" | "graphql";
  };
  /**
   * Name of this connection when a site runs more than one (cases.gg has a
   * separate crash socket). Shows up in logs; the site's status row is shared.
   */
  feed?: string;
  /** Called once per (re)connect. Subscribe to feeds here. */
  onConnect?(ctx: AdapterContext): void;
  /** Called for every server event. Must not throw; parse errors are logged and the raw event kept. */
  handle(evt: IncomingEvent, ctx: AdapterContext): Promise<void> | void;
}
