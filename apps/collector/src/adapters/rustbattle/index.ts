/**
 * RustBattle (rustbattle.com). Socket.IO at wss://api.rustbattle.com/socket.io/
 * with `x-socket-id` (any random id) and `language=en` on the query, using
 * socket.io-msgpack-parser: the Engine.IO handshake and pings are text,
 * every Socket.IO packet is a binary MessagePack object. The adapter
 * declares `protocol: "socketio-msgpack"`; the transport sends the connect
 * packet `{token: null}` itself. Behind Cloudflare; wstap connects without
 * a proxy as of 2026-09-19.
 *
 * The client asks for a game's state with `<game>:index` and the server
 * answers with events of the same name, then keeps pushing that game's
 * changes to everyone. Battles (`case-battles:store` / `:update`), coinflip
 * (`coinflip:store` / `:update`) and crash (`crash:index`) are tracked;
 * see each file for the settlement.
 *
 * Not tracked, by finding on 2026-09-19: upgrader, tower, mines, plinko,
 * keno, 21 and case openings are private games. A real Chrome on each of
 * those pages opened no socket channel for them and nothing about them is
 * broadcast.
 */
import type { SiteAdapter } from "../../core/adapter.js";
import { battles, type RbBattle } from "./battles.js";
import { coinflip, type RbFlip } from "./coinflip.js";
import { crash, type RbCrashGame } from "./crash.js";
import { ORIGIN, SITE } from "./site.js";

const socketId = Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15);

/** Presence, chat, rain, crypto rates and the crash ticker (about four a second): never stored. */
const IGNORE = new Set(["chat:count", "chat:show", "rain:index", "rain:update", "crypto:updated", "crash:multiplier", "crash:items", "live-games:index", "live-trades:index", "live-trades:show", "announcements:store", "announcements:delete", "leaderboard:end", "maintenance", "ack"]);

const b = battles();
const cf = coinflip();
const cr = crash();

export const rustbattle: SiteAdapter = {
  site: SITE,
  connection: { url: "wss://api.rustbattle.com", path: "/socket.io/", protocol: "socketio-msgpack", query: { "x-socket-id": socketId, language: "en" }, pageUrl: `${ORIGIN}/` },

  onConnect(ctx) {
    ctx.emit("crash:index");
    ctx.emit("case-battles:index");
    ctx.emit("coinflip:index");
  },

  handle({ event, args, receivedAt }, ctx) {
    if (IGNORE.has(event)) return;
    const p = args[0];
    ctx.sink.rawEvent({ site: SITE, event, payload: args.length === 1 ? p : args, receivedAt });
    switch (event) {
      case "case-battles:update":
        return b.onUpdate(p as RbBattle, receivedAt, ctx);
      // case-battles:store, case-battles:show: a new lobby or a page's initial state, raw only.
      case "coinflip:update":
      case "coinflip:store":
        return cf.onUpdate(p as { game?: RbFlip } | RbFlip, receivedAt, ctx);
      case "crash:index":
        return cr.onIndex(p as { game?: RbCrashGame }, receivedAt, ctx);
    }
  },
};
