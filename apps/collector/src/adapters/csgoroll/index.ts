/**
 * CSGORoll (csgoroll.com). GraphQL subscriptions over graphql-transport-ws
 * at wss://www.csgoroll.com/ws (`protocol: "graphql"`). Behind Cloudflare;
 * wstap connects without a proxy as of 2026-09-18. A guest may subscribe but
 * not query: any `query` closes the socket with 4401, so the lobbies the
 * site loads over HTTP are not available and only what is pushed counts.
 * Amounts are decimal coins, $0.70 each (site.ts). Ids are the site's Relay
 * ids ("QmF0dGxlOjQwMDUwNDU"), which its URLs use, kept verbatim.
 *
 * Each subscription below is the site's own document, trimmed to the fields
 * the settlement needs. The message id is the operation name, so events
 * arrive under it.
 */
import type { SiteAdapter } from "../../core/adapter.js";
import { handleBattleUpdated } from "./battles.js";
import { handleCrashBetCreated, handleCrashBetUpdated, handleCrashGameCreated, handleCrashGameUpdated } from "./crash.js";
import { handleDiceBets } from "./dice.js";
import { handleRoyalePlayer } from "./royale.js";
import { handleRollBet, handleRollGameCreated, handleRollGameUpdated, resetRoll } from "./roll.js";
import { ORIGIN, SITE } from "./site.js";

const USER = "id name displayName avatar";

/** The finished state carries the whole battle, so the lobby states (CREATED, WAITING_FOR_BOTS, STARTED, IN_PLAY) are not asked for. */
export const BATTLE_STATUSES = ["FINISHED", "CANCELLED"];

export const SUBSCRIPTIONS: Record<string, string> = {
  BattleUpdated: `subscription BattleUpdated($statuses: [BattleStatus!]) { battleUpdated(statuses: $statuses) { battle { id status gameEngine createdAt creatorId tags playerConfiguration totalPlayers isCashoutEnabled private fastMode passwordProtected costOriginal { amount currency } valueOriginal { amount currency } totalPulled { amount currency } sponsorship { percentage amountSponsored } winCriterionName winCriterion { type scope direction grouping } players { won user { ${USER} } } rounds { sequence steps { preselectedStepOption { box { name cost } } } } } } }`,
  RouletteGameCreated: `subscription RouletteGameCreated { createGame { game { id createdAt scheduledAt startedAt status rollValue } } }`,
  RouletteGameUpdated: `subscription RouletteGameUpdated { updateGame { game { id createdAt scheduledAt startedAt status rollValue } } }`,
  RouletteBetCreated: `subscription RouletteBetCreated { createBet { bet { id amount currency selections user { ${USER} } } } }`,
  OnCrashCreateGame: `subscription OnCrashCreateGame { createCrashGame { crashGame { id startedAt status roll cancelledReason } } }`,
  OnCrashUpdateGame: `subscription OnCrashUpdateGame { updateCrashGame { crashGame { id startedAt status roll cancelledReason } } }`,
  OnCreateCrashBet: `subscription OnCreateCrashBet { createCrashBet { crashBet { id gameId currency totalBet maxTick user { ${USER} } items { edges { node { itemVariant { name value } } } } } } }`,
  OnUpdateCrashBet: `subscription OnUpdateCrashBet { updateCrashBet { crashBet { id gameId currency totalBet maxTick tick totalWinAmount user { ${USER} } } } }`,
  BoxJackpotPlayer: `subscription BoxJackpotPlayer { createOrUpdateBoxJackpotPlayer { boxJackpotPlayer { id totalBet currency totalBetBase currencyBase updatedAt boxCount won boxJackpotGame { id status createdAt totalBet totalBetBase totalPayout currency currencyBase playerCount boxCount } user { id displayName avatar } } } }`,
  BoxJackpotGameUpdated: `subscription BoxJackpotGameUpdated { updateBoxJackpotGame { boxJackpotGame { id status createdAt scheduledAt totalBet totalBetBase totalPayout currency currencyBase playerCount boxCount roll { value } } } }`,
  OnCreateDiceBets: `subscription OnCreateDiceBets { createDiceBets { diceBets { id amount totalBet totalPayout won currency choice createdAt chance houseEdgePercent roll { value } target gameType user { ${USER} } } } }`,
};

export const csgoroll: SiteAdapter = {
  site: SITE,
  connection: {
    url: "wss://www.csgoroll.com/ws",
    protocol: "graphql",
    pageUrl: `${ORIGIN}/`,
  },

  onConnect(ctx) {
    resetRoll();
    for (const [name, query] of Object.entries(SUBSCRIPTIONS)) ctx.emit(name, query, name === "BattleUpdated" ? { statuses: BATTLE_STATUSES } : {});
  },

  handle({ event, args, receivedAt }, ctx) {
    const p = args[0];
    switch (event) {
      case "BattleUpdated":
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handleBattleUpdated(p, receivedAt, ctx);

      case "RouletteGameCreated":
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handleRollGameCreated(p, receivedAt);
      case "RouletteBetCreated":
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handleRollBet(p, receivedAt, ctx);
      case "RouletteGameUpdated":
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handleRollGameUpdated(p, receivedAt, ctx);

      case "OnCrashCreateGame":
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handleCrashGameCreated(p, receivedAt);
      case "OnCreateCrashBet":
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handleCrashBetCreated(p, receivedAt, ctx);
      case "OnUpdateCrashBet":
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handleCrashBetUpdated(p, receivedAt, ctx);
      case "OnCrashUpdateGame":
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handleCrashGameUpdated(p, receivedAt, ctx);

      case "OnCreateDiceBets":
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handleDiceBets(p, receivedAt, ctx);

      case "BoxJackpotPlayer":
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return handleRoyalePlayer(p, receivedAt, ctx);
      case "BoxJackpotGameUpdated":
        // Raw only: the player updates settle the round. Kept so a reparse can if they do not.
        ctx.sink.rawEvent({ site: SITE, event, payload: p, receivedAt });
        return;

      case "error":
        ctx.log.warn({ errors: p, subscription: args[1] }, "subscription error");
        return;
      case "complete":
        ctx.log.warn({ subscription: p }, "subscription completed by the server");
        return;
    }
  },
};
