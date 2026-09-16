/**
 * RustEasy (rusteasy.com). Socket.IO at wss://api.rusteasy.com/socket.io/
 * with `userStatus=guest` on the query (the `sid` the browser adds is just
 * Engine.IO's session id and must not be sent). Behind Cloudflare, connects
 * through wstap without a proxy as of 2026-09-16. Feeds are joined with
 * `joinRoom <name>`; payloads are often JSON strings.
 *
 * Not tracked, by finding on 2026-09-16: cases, upgrader, mines and bust
 * (blackjack) are private HTTP games whose only public trace is the
 * `live.wins` ticker (wins only), kept raw.
 */
import type { SiteAdapter } from "../../core/adapter.js";
import { handleBattleFinished, handleBattleNew, handleBattleRound, handleBattleWinner } from "./battles.js";
import { handleChallenger, handleChampionEnd, handleChampionHolder } from "./champion.js";
import { handleCoinflipNew, handleCoinflipUpdate } from "./coinflip.js";
import { handleDoubleBet, handleDoubleSpin } from "./double.js";
import { handleJackpotDeposit, handleJackpotNewGame, handleJackpotSlider } from "./jackpot.js";
import { ORIGIN, SITE } from "./site.js";

export const ROOMS = ["casebattles", "coinflip", "jackpot", "roullete", "champion"];

/** Presence, chat, rain, countdown ticks and site-wide totals: never stored. */
const IGNORE = new Set([
  "online", "singleOnline", "handleRainUpdate", "handleRainStarted", "handleFreeCase", "new_msg", "refreshChat", "games", "exp_update",
  "updateGameAmounts", "gameStatsUpdated", "roulleteTime", "timer", "championTimer", "championQueue", "playAttack", "updateHoldUsers", "updateNotifications",
  "new_emoji", "new_emoji_guest",
]);

export const rusteasy: SiteAdapter = {
  site: SITE,
  connection: {
    url: "wss://api.rusteasy.com",
    path: "/socket.io/",
    query: { userStatus: "guest" },
    pageUrl: `${ORIGIN}/`,
  },

  onConnect(ctx) {
    for (const room of ROOMS) ctx.emit("joinRoom", room);
  },

  handle({ event, args, receivedAt }, ctx) {
    if (IGNORE.has(event)) return;
    const p = args[0];
    ctx.sink.rawEvent({ site: SITE, event, payload: args.length === 1 ? p : args, receivedAt });

    switch (event) {
      case "newCaseBattle":
        return handleBattleNew(p, receivedAt, ctx);
      case "battles:round":
        return handleBattleRound(p);
      case "battles:finished":
        return handleBattleFinished(p, receivedAt, ctx);
      case "caseBattleWinner":
        return handleBattleWinner(p, receivedAt, ctx);
      // battle:starting, battles:drops, battle:tie, battle:expire (battle rooms): raw only.

      case "newCoinflipGame":
        return handleCoinflipNew(p, receivedAt, ctx);
      case "coinflipGameUpdate":
        return handleCoinflipUpdate(p, receivedAt, ctx);

      case "newDeposit":
        return handleJackpotDeposit(p, receivedAt, ctx);
      case "newGame":
        return handleJackpotNewGame(p, receivedAt);
      case "slider":
        return handleJackpotSlider(p, receivedAt, ctx);

      case "roullete_bet":
        return handleDoubleBet(p, receivedAt, ctx);
      case "roullete_slider":
        return handleDoubleSpin(p, receivedAt, ctx);

      case "challengerInfo":
        return handleChallenger(p, receivedAt, ctx);
      case "championEnd":
        return handleChampionEnd();
      case "newChampionInfo":
      case "champion":
        return handleChampionHolder(p, receivedAt, ctx);
      // live.wins: raw only.
    }
  },
};
