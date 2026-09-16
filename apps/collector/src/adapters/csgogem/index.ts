/**
 * CSGOGem (csgogem.com). Raw websocket at wss://api.csgogem.com/, no
 * Socket.IO: frames are `[id, event, data]`, we subscribe by sending
 * `[id, "subscribe", [namespaces]]` and the server acks `[id, null, {ns: true}]`.
 * No Cloudflare challenge on the socket as of 2026-09-15; wstap connects
 * directly. The server uses permessage-deflate with context takeover.
 *
 * Namespaces used: battle, slide, roulette ("Double").
 *
 * Not tracked, by decision on 2026-09-15:
 *  - upgrade, mines, keno ("Tiles"): the public feed only broadcasts wins
 *    (`upgrade.onWin`, `mines.onLiveGame`, `keno.onLiveGame`), never losses,
 *    so volume and house net cannot be measured.
 *  - cases: not on the public socket ("case" is rejected with
 *    MalformedRequest) and the site's client has no live opening feed.
 */
import type { SiteAdapter } from "../../core/adapter.js";
import { handleBattleCancelled, handleBattleEnd, handleBattleList, handleBattleNew, handleBattleSpin, handleBattleWager } from "./battles.js";
import { SITE, setFxRates } from "./site.js";
import { handleRouletteNewRound, handleRouletteRound, handleRouletteSpin, handleRouletteWagers, handleSlideNewRound, handleSlideRound, handleSlideSpin, handleSlideWagers } from "./wheel.js";
import type { GemFxRates } from "./types.js";

export const NAMESPACES = ["battle", "slide", "roulette"];

/** Chatter we never store raw: presence, chat, rewards, the bulky config blob, per-spin battle rounds. */
const IGNORE = new Set([
  "config", "user", "app.onlineCount", "app.rewards", "app.dynamicValues", "app.highlights",
  "battle.onSpectators", "battle.onReact", "battle.onBlockCountdown", "battle.onBlockCommitted", "battle.onBlockHash",
  "slide.jackpot", "slide.onBlockCountdown", "slide.onBlockCommitted", "slide.onBlockHash", "slide.history",
  "roulette.jackpot", "roulette.aggregations", "roulette.onBlockCountdown", "roulette.onBlockCommitted", "roulette.onBlockHash", "roulette.history",
]);
const RAW_SKIP_PREFIX = ["chat."];

export const csgogem: SiteAdapter = {
  site: SITE,
  connection: {
    url: "wss://api.csgogem.com/",
    protocol: "raw",
    pageUrl: "https://csgogem.com/",
  },

  onConnect(ctx) {
    ctx.emit("subscribe", NAMESPACES);
  },

  handle({ event, args, receivedAt }, ctx) {
    if (IGNORE.has(event) || RAW_SKIP_PREFIX.some((p) => event.startsWith(p))) return;
    const p = args[0];

    if (event === "ack") {
      const ok = p && typeof p === "object" ? Object.entries(p as Record<string, boolean>).filter(([, v]) => v).map(([k]) => k) : [];
      if (ok.length) ctx.log.info({ namespaces: ok }, "subscribed");
      return;
    }
    if (args.length === 2 && typeof args[1] === "number") {
      ctx.log.warn({ event, requestId: args[1] }, "request rejected");
      return;
    }
    // battle.onGameSpin is one frame per case per battle (hundreds a minute); the final one is all we need.
    if (event !== "battle.onGameSpin" || (p as { payouts?: unknown })?.payouts) {
      ctx.sink.rawEvent({ site: SITE, event, payload: args.length === 1 ? p : args, receivedAt });
    }

    switch (event) {
      case "app.onFxRateUpdate":
        return setFxRates(p as GemFxRates);

      case "battle.list":
        return handleBattleList(p, receivedAt, ctx);
      case "battle.onNewGame":
        return handleBattleNew(p, receivedAt, ctx);
      case "battle.onWager":
        return handleBattleWager(p, receivedAt, ctx);
      case "battle.onGameSpin":
        return handleBattleSpin(p);
      case "battle.onGameEnd":
        return handleBattleEnd(p, receivedAt, ctx);
      case "battle.onGameCancelled":
        return handleBattleCancelled(p);

      case "slide.round":
        return handleSlideRound(p, receivedAt, ctx);
      case "slide.onNewRound":
        return handleSlideNewRound(p, receivedAt);
      case "slide.wagers":
        return handleSlideWagers(p, receivedAt, ctx);
      case "slide.onGameSpin":
        return handleSlideSpin(p, receivedAt, ctx);

      case "roulette.round":
        return handleRouletteRound(p, receivedAt, ctx);
      case "roulette.onNewRound":
        return handleRouletteNewRound(p, receivedAt);
      case "roulette.wagers":
        return handleRouletteWagers(p, receivedAt, ctx);
      case "roulette.onGameSpin":
        return handleRouletteSpin(p, receivedAt, ctx);
    }
  },
};
