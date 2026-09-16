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
    /** Extra headers sent on the upgrade request. */
    headers?: Record<string, string>;
    /** Page to load in the browser transport. Defaults to the site origin. */
    pageUrl?: string;
    /**
     * Wire protocol. "socketio" (default) appends the Engine.IO path and
     * query and frames events as "42[...]". "raw" connects to `url` verbatim
     * and frames as JSON arrays `[id, event, data]` (csgogem). Only the wstap
     * transport speaks "raw".
     */
    protocol?: "socketio" | "raw";
  };
  /** Called once per (re)connect. Subscribe to feeds here. */
  onConnect?(ctx: AdapterContext): void;
  /** Called for every server event. Must not throw; parse errors are logged and the raw event kept. */
  handle(evt: IncomingEvent, ctx: AdapterContext): Promise<void> | void;
}
