import type { SiteAdapter } from "../../core/adapter.js";
import { handleCoinflip, handleCoinflipRemoved, SITE } from "./coinflip.js";
import { handleJackpotDeposit, handleJackpotDeposits, handleJackpotHash, handleJackpotHistory, handleJackpotReset, handleJackpotWinner } from "./jackpot.js";
import type { RpCoinflip } from "./types.js";

/** High-volume or irrelevant events we never store raw. */
const IGNORE = new Set(["return chatHistory", "new Chat", "chat message", "chatMessage", "rewards_balance", "jackpot time", "jackpot roll", "online", "FG general"]);

export const rustypot: SiteAdapter = {
  site: SITE,
  connection: {
    url: "wss://rustypot.com",
    path: "/socket.io/",
    // The jackpot page's client subscribes to jackpot + coinflip feeds on load.
    pageUrl: "https://rustypot.com/",
  },

  onConnect(ctx) {
    // Only reaches the server on the socket.io transport; the browser transport is read-only.
    ctx.emit("get cfLobbys");
    ctx.emit("jackpot get deposits");
    ctx.emit("get jackpotGameHistory");
    ctx.emit("get jackpotGameHash");
  },

  handle({ event, args, receivedAt }, ctx) {
    if (IGNORE.has(event)) return;
    ctx.sink.rawEvent({ site: SITE, event, payload: args.length === 1 ? args[0] : args, receivedAt });
    const p = args[0];

    switch (event) {
      case "updateCFStatus":
      case "cf newLobby":
        return handleCoinflip(p as RpCoinflip, receivedAt, ctx);
      case "cfLobbys":
      case "return cfLobbys":
      case "return allActiveCoinflips":
      case "cf history":
      case "return cf history":
        if (Array.isArray(p)) for (const cf of p) handleCoinflip(cf as RpCoinflip, receivedAt, ctx);
        return;
      case "cf RemoveLobby":
        return handleCoinflipRemoved(p, receivedAt, ctx);

      case "jackpot CurrentGameHash":
        return handleJackpotHash(p, receivedAt);
      case "jackpot deposit":
        return handleJackpotDeposit(p, receivedAt, ctx);
      case "return jackpot deposit":
        return handleJackpotDeposits(p, receivedAt, ctx);
      case "jackpot winnerInfo":
        return handleJackpotWinner(p, receivedAt, ctx);
      case "ensure jackpot reset":
        return handleJackpotReset(p, receivedAt, ctx);
      case "return jackpotGameHistory":
        return handleJackpotHistory(p, receivedAt, ctx);
      // "gamemode_totals" {jackpot, coinflip} and "new BiggestBet" are kept raw only for now.
    }
  },
};
