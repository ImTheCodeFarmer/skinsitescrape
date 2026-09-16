/**
 * Cases.gg, a Clash-platform site (see ../clash-family). Two plain
 * websockets, both framed as `[event, data]` (`protocol: "pair"`), both
 * behind Cloudflare, both fine through wstap without a proxy as of
 * 2026-09-16:
 *
 *  - wss://ws.cases.gg/   the main feed. Send `["subscribe", <channel>]`;
 *    channels used here are "battles" and "item-coinflip" (also on offer:
 *    "battle-<id>", "chat", "rain", "raffles"). "online" ticks every ~5s.
 *  - wss://cgs.cases.gg/  crash, which streams to everyone with no
 *    subscription.
 *
 * Money is cents of USD. Not tracked, by finding on 2026-09-16: mystery box
 * openings and the upgrader go over HTTP only and have no public feed, so
 * neither volume nor outcome can be seen.
 */
import type { SiteAdapter } from "../../core/adapter.js";
import { battles } from "../clash-family/battles.js";
import { coinflip } from "../clash-family/coinflip.js";
import { crash } from "../clash-family/crash.js";
import { type FamilySite, round4 } from "../clash-family/site.js";

const site: FamilySite = { slug: "cases", origin: "https://cases.gg", usd: (cents) => round4((Number(cents) || 0) / 100) };

export const CHANNELS = ["battles", "item-coinflip"];

/** Presence ticks, never stored. */
const IGNORE = new Set(["online"]);

const b = battles(site);
const cf = coinflip(site);

export const cases: SiteAdapter = {
  site: site.slug,
  feed: "main",
  connection: { url: "wss://ws.cases.gg/", protocol: "pair", pageUrl: `${site.origin}/` },

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

      case "item-coinflip:new":
      case "item-coinflip:update":
        return cf.onGame(p, receivedAt, ctx);
      // item-coinflip:awaiting-eos: raw only.
    }
  },
};

export const casesCrash: SiteAdapter = crash(site).adapter("wss://cgs.cases.gg/");
