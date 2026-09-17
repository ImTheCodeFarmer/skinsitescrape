/**
 * Rustyloot (rustyloot.gg). Socket.IO at wss://api.rustyloot.gg/socket.io/
 * with `language=en` on the query. Behind Cloudflare; wstap connects without
 * a proxy as of 2026-09-17. Rooms are joined with `<game>:connect {}`.
 * Amounts are thousandths of a coin, 1.55 coins to the dollar (site.ts).
 *
 * Battles (with borrow), Wheel, PVP Mines and Coinflip come from their own
 * rooms, with player ids.
 *
 * Not tracked, by decision on 2026-09-17: Plinko, Upgrader, Mines and Cases
 * are private games. Their only public trace is `betting:live-bets`, the
 * site's live bet table, which does show losses but carries no bet or user
 * ids (players would have to be matched by name) and is dripped at one row a
 * second, so its completeness under load is unknown. It is not collected.
 */
import type { SiteAdapter } from "../../core/adapter.js";
import { handleBattleNew, handleBattlePlayer, handleBattleResults } from "./battles.js";
import { handleCoinflip, handlePvpMines, handleWheelState } from "./games.js";
import { ORIGIN, SITE } from "./site.js";

export const ROOMS = ["battles", "wheel", "pvpmines", "coinflip"];

export const rustyloot: SiteAdapter = {
  site: SITE,
  connection: {
    url: "wss://api.rustyloot.gg",
    path: "/socket.io/",
    query: { language: "en" },
    pageUrl: `${ORIGIN}/`,
  },

  onConnect(ctx) {
    for (const room of ROOMS) ctx.emit(`${room}:connect`, {});
  },

  handle({ event, args, receivedAt }, ctx) {
    const p = args[0];
    switch (event) {
      case "battles:new":
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handleBattleNew(p, receivedAt);
      case "battles:newPlayer":
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handleBattlePlayer(p);
      case "battles:results":
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handleBattleResults(p, receivedAt, ctx);
      // battles:locked, rollRound, allRoundData, crediting, ended: nothing the settlement needs.

      case "wheel:updateState":
        // Every state repeats the round's bets; only the ended one is kept.
        if ((p as { gameState?: { status?: string } })?.gameState?.status !== "ended") return;
        ctx.sink.rawEvent({ site: SITE, event, payload: { gameState: { ...(p as { gameState: object }).gameState, currentTopLeaderboard: undefined } }, receivedAt });
        return handleWheelState(p, receivedAt, ctx);

      case "pvpmines:update":
        if ((p as { data?: { status?: string } })?.data?.status !== "ended") return;
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handlePvpMines(p, receivedAt, ctx);

      case "coinflip:update":
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handleCoinflip(p, receivedAt, ctx);
    }
  },
};
