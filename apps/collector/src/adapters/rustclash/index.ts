/**
 * RustClash (rustclash.com), the Clash platform's Rust-skins site (see
 * ../clash-family and ../clash). Same wire format as clash.gg: plain
 * websockets framed as `[event, data]` (`protocol: "pair"`). Both hosts are
 * Cloudflare-challenged; wstap gets through, on a clean IP or after a short
 * proxy hunt, as of 2026-09-19:
 *
 *  - wss://ws.rustclash.com/   the main feed. Channels used: "battles",
 *    "roulette" (Double), "plinko". Also on offer: "chat", "rain".
 *  - wss://cgs.rustclash.com/  crash, streamed to everyone (the cases.gg
 *    host name, not clash.gg's gs.).
 *
 * Money is integer cents of gems; 1 gem = $0.60, the same rate as Clash.gg
 * (the legacy dashboard used it for both). Only `currency: "REAL"` counts.
 *
 * Not tracked, by finding on 2026-09-19: case openings, the upgrader,
 * mines, roll and tiles are private HTTP games. A real Chrome on each of
 * those pages opened no socket channel for them, and subscribing to "roll",
 * "drops" and "crash" on the main socket produced nothing. There is no
 * champion game here.
 */
import type { SiteAdapter } from "../../core/adapter.js";
import { battles } from "../clash-family/battles.js";
import { crash } from "../clash-family/crash.js";
import { plinko } from "../clash-family/plinko.js";
import { roulette } from "../clash-family/roulette.js";
import { type FamilySite, round4 } from "../clash-family/site.js";

export const GEM_USD = 0.6;
const site: FamilySite = { slug: "rustclash", origin: "https://rustclash.com", usd: (cents) => round4(((Number(cents) || 0) / 100) * GEM_USD) };

export const CHANNELS = ["battles", "roulette", "plinko"];

/** Presence, emoji reactions, the rain pot and the roulette jackpot pool: never stored. */
const IGNORE = new Set(["online", "battles:reaction", "battles:rain", "battles:rain-roll", "roulette:jackpot"]);

const b = battles(site);
const r = roulette(site);
const pl = plinko(site);

export const rustclash: SiteAdapter = {
  site: site.slug,
  feed: "main",
  connection: { url: "wss://ws.rustclash.com/", protocol: "pair", pageUrl: `${site.origin}/` },

  onConnect(ctx) {
    for (const c of CHANNELS) ctx.emit("subscribe", c);
  },

  handle({ event, args, receivedAt }, ctx) {
    if (IGNORE.has(event) || event.startsWith("crash:")) return;
    const p = args[0];
    ctx.sink.rawEvent({ site: site.slug, event, payload: args.length === 1 ? p : args, receivedAt });

    switch (event) {
      case "battles:new":
        return b.onNew(p, receivedAt, ctx);
      case "battles:join":
        return b.onJoin(p, receivedAt, ctx);
      case "battles:join-bots":
        return b.onJoinBots(p, receivedAt, ctx);
      case "battles:start":
        return b.onStart(p);
      case "battles:round":
        return b.onRound(p);
      case "battles:finished":
        return b.onFinished(p, receivedAt, ctx);
      // battles:awaiting-eos, battles:double-down: raw only.

      case "roulette:bet":
        return r.onBet(p, receivedAt, ctx);
      case "roulette:round":
        return r.onRound(p, receivedAt, ctx);

      case "plinko:social-game":
        return pl.onGame(p, receivedAt, ctx);
    }
  },
};

export const rustclashCrash: SiteAdapter = crash(site).adapter("wss://cgs.rustclash.com/");
