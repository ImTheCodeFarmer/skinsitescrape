/**
 * Rustyloot (rustyloot.gg). Socket.IO at wss://api.rustyloot.gg/socket.io/
 * with `language=en` on the query. Behind Cloudflare; wstap connects without
 * a proxy as of 2026-09-17. Rooms are joined with `<game>:connect {}`.
 * Amounts are thousandths of a coin, 1.55 coins to the dollar (site.ts).
 *
 * Battles (with borrow), Wheel, PVP Mines and Coinflip come from their own
 * rooms, with player ids.
 *
 * Chat is not collected, but it is watched: every message (and the backlog
 * that arrives with `system:connect`) carries the speaker's site id and
 * `steamid`, which become player_identities rows so Rustyloot accounts link
 * to the same Steam account on other sites. No message text is kept.
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
import type { AdapterContext } from "../../core/adapter.js";

type ChatUser = { id?: number | string; steamid?: string | null; username?: string | null; avatar?: string | null };

/** Remember who a chat user is on Steam; the message itself is dropped. */
function seenInChat(u: ChatUser | null | undefined, at: Date, ctx: AdapterContext) {
  if (u?.id == null || !u.steamid) return;
  const id = String(u.id);
  ctx.sink.player({ site: SITE, externalId: id, displayName: u.username ?? null, avatar: u.avatar ?? null, seenAt: at });
  ctx.sink.identity({ site: SITE, externalId: id, steamId: String(u.steamid), source: "chat", seenAt: at });
}

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
      case "system:connect": {
        // Recent chat per language room, sent once on connect.
        const rooms = (p as { chat?: Record<string, { user?: ChatUser }[]> })?.chat ?? {};
        for (const msgs of Object.values(rooms)) for (const m of msgs ?? []) seenInChat(m?.user, receivedAt, ctx);
        return;
      }
      case "chat:message:new":
        return seenInChat((p as { user?: ChatUser })?.user, receivedAt, ctx);

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
