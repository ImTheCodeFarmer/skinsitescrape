/**
 * Cases.gg. Two plain websockets, both framed as `[event, data]`
 * (`protocol: "pair"`), both behind Cloudflare, both fine through wstap
 * without a proxy as of 2026-09-16:
 *
 *  - wss://ws.cases.gg/   the main feed. Send `["subscribe", <channel>]`;
 *    channels used here are "battles" and "item-coinflip" (also on offer:
 *    "battle-<id>", "chat", "rain", "raffles"). "online" ticks every ~5s.
 *  - wss://cgs.cases.gg/  crash, which streams to everyone with no
 *    subscription.
 *
 * Not tracked, by finding on 2026-09-16: mystery box openings and the
 * upgrader go over HTTP only and have no public feed, so neither volume
 * nor outcome can be seen.
 */
import type { SiteAdapter } from "../../core/adapter.js";
import { handleBattleFinished, handleBattleJoin, handleBattleJoinBots, handleBattleNew, handleBattleRound, handleBattleStart } from "./battles.js";
import { handleCoinflipGame } from "./coinflip.js";
import { handleCrashBet, handleCrashHistory, handleCrashStatus, handleCrashTick } from "./crash.js";
import { ORIGIN, SITE } from "./site.js";
import type { CgCrashTick } from "./types.js";

export const CHANNELS = ["battles", "item-coinflip"];

/** Presence ticks, never stored. */
const IGNORE = new Set(["online"]);

export const cases: SiteAdapter = {
  site: SITE,
  feed: "main",
  connection: {
    url: "wss://ws.cases.gg/",
    protocol: "pair",
    pageUrl: `${ORIGIN}/`,
  },

  onConnect(ctx) {
    for (const c of CHANNELS) ctx.emit("subscribe", c);
  },

  handle({ event, args, receivedAt }, ctx) {
    if (IGNORE.has(event) || event.startsWith("crash:")) return;
    const p = args[0];
    ctx.sink.rawEvent({ site: SITE, event, payload: args.length === 1 ? p : args, receivedAt });

    switch (event) {
      case "battles:new":
        return handleBattleNew(p, receivedAt, ctx);
      case "battles:join":
        return handleBattleJoin(p, receivedAt, ctx);
      case "battles:join-bots":
        return handleBattleJoinBots(p, receivedAt, ctx);
      case "battles:start":
        return handleBattleStart(p);
      case "battles:round":
        return handleBattleRound(p);
      case "battles:finished":
        return handleBattleFinished(p, receivedAt, ctx);
      // battles:awaiting-eos, battles:double-down: raw only.

      case "item-coinflip:new":
      case "item-coinflip:update":
        return handleCoinflipGame(p, receivedAt, ctx);
      // item-coinflip:awaiting-eos: raw only.
    }
  },
};

/**
 * Raw rows from this socket are stored as "crash:<event>" so they can be told
 * from the main feed's; a reparse hands them back with that prefix.
 */
const CRASH = "crash:";

export const casesCrash: SiteAdapter = {
  site: SITE,
  feed: "crash",
  connection: {
    url: "wss://cgs.cases.gg/",
    protocol: "pair",
    pageUrl: `${ORIGIN}/crash`,
  },

  handle({ event: name, args, receivedAt }, ctx) {
    const event = name.startsWith(CRASH) ? name.slice(CRASH.length) : name;
    if (!["status", "bet", "tick", "historyEntry"].includes(event)) return;
    const p = args[0];
    // Ticks are ~7/s; only the ones that carry a cashout are worth keeping.
    if (event !== "tick" || (p as CgCrashTick)?.cashouts?.length) {
      ctx.sink.rawEvent({ site: SITE, event: CRASH + event, payload: args.length === 1 ? p : args, receivedAt });
    }
    switch (event) {
      case "status":
        return handleCrashStatus(p, receivedAt, ctx);
      case "bet":
        return handleCrashBet(p);
      case "tick":
        return handleCrashTick(p);
      case "historyEntry":
        return handleCrashHistory(p, receivedAt, ctx);
    }
  },
};
