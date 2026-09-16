/**
 * Clash.gg, the Clash platform's home site (see ../clash-family). Two plain
 * websockets framed as `[event, data]` (`protocol: "pair"`); the HTTP side
 * is Cloudflare-challenged but both sockets accept wstap without a proxy as
 * of 2026-09-16:
 *
 *  - wss://ws.clash.gg/  the main feed. Channels used: "battles",
 *    "roulette" (Double), "plinko" (other players' balls), "champion-match".
 *    Also on offer: "drops" (a wins-only ticker), "chat", "rain".
 *  - wss://gs.clash.gg/  crash, streamed to everyone.
 *
 * Money is integer cents of gems; 1 gem = $0.60 (the legacy dashboard's
 * rate, and what the feed's item prices give against Steam prices: a $0.35
 * skin is priced 58). Only `currency: "REAL"` counts; PLAY and BONUS are
 * play money.
 *
 * Not tracked, by finding on 2026-09-16: case openings, the upgrader,
 * mines and tiles are private HTTP games whose only public trace is the
 * "drops" ticker (wins only), so neither volume nor house net can be seen.
 */
import type { SiteAdapter } from "../../core/adapter.js";
import { battles } from "../clash-family/battles.js";
import { champion } from "../clash-family/champion.js";
import { crash } from "../clash-family/crash.js";
import { plinko } from "../clash-family/plinko.js";
import { roulette } from "../clash-family/roulette.js";
import { type FamilySite, round4 } from "../clash-family/site.js";

export const GEM_USD = 0.6;
const site: FamilySite = { slug: "clash", origin: "https://clash.gg", usd: (cents) => round4(((Number(cents) || 0) / 100) * GEM_USD) };

export const CHANNELS = ["battles", "roulette", "plinko", "champion-match"];

/** Presence, emoji reactions, the rain pot and the roulette jackpot pool: never stored. */
const IGNORE = new Set(["online", "battles:reaction", "battles:rain", "battles:rain-roll", "roulette:jackpot"]);
/** Champion events are `champion-match:<TYPE>:<name>`; the fight blows are ~1/s and not needed. */
const champEvent = (event: string) => (event.startsWith("champion-match:") ? event.slice(event.lastIndexOf(":") + 1) : null);

const b = battles(site);
const r = roulette(site);
const pl = plinko(site);
const ch = champion(site);

export const clash: SiteAdapter = {
  site: site.slug,
  feed: "main",
  connection: { url: "wss://ws.clash.gg/", protocol: "pair", pageUrl: `${site.origin}/` },

  onConnect(ctx) {
    for (const c of CHANNELS) ctx.emit("subscribe", c);
  },

  handle({ event, args, receivedAt }, ctx) {
    if (IGNORE.has(event) || event.startsWith("crash:")) return;
    const champ = champEvent(event);
    if (champ === "attack" || champ === "queue-update") return;
    const p = args[0];
    ctx.sink.rawEvent({ site: site.slug, event, payload: args.length === 1 ? p : args, receivedAt });

    if (champ === "round-update") return ch.onRound(p, receivedAt, ctx);
    if (champ === "match-finish") return ch.onFinish(p, receivedAt, ctx);

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

export const clashCrash: SiteAdapter = crash(site).adapter("wss://gs.clash.gg/");
