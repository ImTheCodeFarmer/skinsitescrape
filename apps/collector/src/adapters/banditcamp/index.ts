/**
 * Bandit.camp. Raw websocket at wss://api.bandit.camp/, no Socket.IO: frames
 * are `{"a":[event, ...args], "i":id}` and replies `{"i":id, "d":data}`
 * (protocol "envelope"). Behind Cloudflare; wstap connects without a proxy
 * as of 2026-09-17. Rooms are joined with `subscribe <room>`; the wins
 * ticker (`games.feed.new`) needs no room. Amounts are scrap in hundredths,
 * converted at the site's own USD rate (site.ts).
 *
 * Tracked: Crate Battles, Crate Royale, Wheel of Fortune, Spinner Battles
 * and Crate Unboxing (see cases.ts for why the ticker is enough there).
 *
 * Not tracked, by finding on 2026-09-17: Minefield Madness, Scrap Upgrader
 * and Beancan Blast ("dice") are private request/reply games whose only
 * public trace is the wins ticker, which never shows a loss for them. Kept
 * raw.
 */
import type { SiteAdapter } from "../../core/adapter.js";
import { handleBattleActive, handleBattleExpired, handleBattleFinished, handleBattleJoined, handleBattleNew } from "./battles.js";
import { handleCaseList, handleFeedItem, requestPrices } from "./cases.js";
import { handleRoyaleActive, handleRoyaleEntry, handleRoyaleNew, handleRoyaleRoll, handleRoyaleStats } from "./royale.js";
import { ORIGIN, SITE, setScrapRate } from "./site.js";
import { handleSpinActive, handleSpinExpired, handleSpinJoined, handleSpinNew, handleSpinRoll, setSpinnerRake } from "./spinners.js";
import { handleWheelBet, handleWheelDelete, handleWheelRoll, handleWheelRound } from "./wheel.js";

export const ROOMS = ["caseBattles", "caseJackpot", "wheel", "spinners"];

/** Presence, chat, countdowns and per-case battle rolls (hundreds a minute): never stored. */
const IGNORE = new Set([
  "connect", "connected", "app.online", "app.user", "games.feed", "chat.discord.vc",
  "game.caseBattles.rollRound", "game.caseBattles.lock", "game.caseBattles.battle.spectators", "game.caseBattles.battle.reaction",
  "game.caseJackpot.stats", "game.caseJackpot.countdown", "game.caseJackpot.open", "game.caseJackpot.lock",
  "game.wheel.history", "game.wheel.locked", "game.spinners.lock",
]);
const SKIP_PREFIX = ["chat.", "user.", "crypto."];

export const banditcamp: SiteAdapter = {
  site: SITE,
  connection: {
    url: "wss://api.bandit.camp/",
    protocol: "envelope",
    pageUrl: `${ORIGIN}/`,
  },

  onConnect(ctx) {
    for (const room of ROOMS) ctx.emit("subscribe", room);
    ctx.emit("game.caseJackpot.active.stats");
    requestPrices(ctx);
  },

  handle({ event, args, receivedAt }, ctx) {
    if (IGNORE.has(event) || SKIP_PREFIX.some((p) => event.startsWith(p))) return;
    const p = args[0];

    if (event === "ack") {
      // Replies carry no request name: tell them apart by shape. Anything else is a subscribe `{success}`.
      if (!handleCaseList(p, ctx)) handleRoyaleStats(p);
      return;
    }
    if (event === "nack") {
      ctx.log.warn({ error: p, requestId: args[1] }, "request rejected");
      return;
    }
    if (event === "app.conga") {
      setScrapRate((p as { withdrawals?: { crypto?: { scrapRateUsd?: number } } })?.withdrawals?.crypto?.scrapRateUsd);
      setSpinnerRake((p as { games?: { spinners?: { rake?: number } } })?.games?.spinners?.rake);
      return;
    }

    // A lone array payload is wrapped so a reparse (which spreads arrays into args) hands it back whole.
    ctx.sink.rawEvent({ site: SITE, event, payload: args.length === 1 && !Array.isArray(p) ? p : args, receivedAt });

    switch (event) {
      case "game.caseBattles.active":
        return handleBattleActive(p, receivedAt, ctx);
      case "game.caseBattles.new":
        return handleBattleNew(p, receivedAt, ctx);
      case "game.caseBattles.playerJoined":
        return handleBattleJoined(p, receivedAt, ctx);
      case "game.caseBattles.finished":
        return handleBattleFinished(p, receivedAt, ctx);
      case "game.caseBattles.expired":
        return handleBattleExpired(p);

      case "game.caseJackpot.active":
        return handleRoyaleActive(p, receivedAt);
      case "game.caseJackpot.new":
        return handleRoyaleNew(p, receivedAt);
      case "game.caseJackpot.newEntry":
        return handleRoyaleEntry(p, receivedAt, ctx);
      case "game.caseJackpot.roll":
        return handleRoyaleRoll(p, receivedAt, ctx);
      // game.caseJackpot.recentWin: raw only, the site's own total to check the pot against.

      case "game.wheel.round":
        return handleWheelRound(p, receivedAt, ctx);
      case "game.wheel.newBet":
        return handleWheelBet(p, receivedAt, ctx);
      case "game.wheel.deleteBet":
        return handleWheelDelete(p);
      case "game.wheel.roll":
        return handleWheelRoll(p, receivedAt, ctx);

      case "game.spinners.active":
        return handleSpinActive(p, receivedAt, ctx);
      case "game.spinners.new":
        return handleSpinNew(p, receivedAt, ctx);
      case "game.spinners.joined":
        return handleSpinJoined(p, receivedAt, ctx);
      case "game.spinners.roll":
        return handleSpinRoll(p, receivedAt, ctx);
      case "game.spinners.expired":
        return handleSpinExpired(p);

      case "games.feed.new":
        return handleFeedItem(p, receivedAt, ctx);
    }
  },
};
