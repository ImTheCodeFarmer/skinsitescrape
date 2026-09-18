/**
 * PVP 2.0, the site's case battles. `battleUpdated(statuses)` pushes the
 * whole battle on every status change, and since the document is ours, the
 * FINISHED message carries everything the settlement needs: `costOriginal`
 * (one seat, the sum of the rounds' box costs, in the creator's currency),
 * `players[].won`, `totalPulled` (everything unboxed, which the site labels
 * USD) and `sponsorship`. Nothing has to be remembered between messages, so
 * battles already running at connect settle like any other.
 *
 * Rules, per the site's own labels: `playerConfiguration` is `S<n>` (free
 * for all), `T<size>X<teams>` (teams) or `T<n>` (one team against the
 * house, where every seat wins). Every seat pays the seat cost; the seats
 * with `won` split `totalPulled` equally (assumed for teams, exact for a
 * single winner and for group mode). `winCriterion` names the mode:
 * PAYOUT_SUM highest is standard, lowest is "crazy", PAYOUT_SUM_RANDOM is
 * the jackpot draw weighted by what each side pulled. With `sponsorship` the
 * creator pays `percentage` of every other seat's cost, by assumption: it
 * was null in every battle seen. Battles paid in `BOX_KEY` (promotional
 * keys, not money) are kept raw and not settled.
 *
 * The house's seats are users named "Bot #<n>" with the site's chicken
 * avatar; they carry ordinary user ids and are stored as house players.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { knownCurrency, seen, SITE, usd, type RollUser } from "./site.js";

type Monetary = { amount?: number; currency?: string } | null;
type BattlePlayer = { won?: boolean | null; user?: RollUser | null };
type Battle = {
  id: string;
  status?: string;
  gameEngine?: string;
  createdAt?: string;
  creatorId?: string;
  tags?: string[];
  playerConfiguration?: string[];
  totalPlayers?: number;
  isCashoutEnabled?: boolean;
  private?: boolean;
  fastMode?: boolean;
  passwordProtected?: boolean;
  costOriginal?: Monetary;
  valueOriginal?: Monetary;
  totalPulled?: Monetary;
  sponsorship?: { percentage?: number; amountSponsored?: number } | null;
  winCriterionName?: string;
  winCriterion?: { type?: string; scope?: string; direction?: string; grouping?: string } | null;
  players?: BattlePlayer[];
  rounds?: { steps?: { preselectedStepOption?: { box?: { name?: string; cost?: number } } }[] }[];
};

const settled = new Set<string>();

export const isBot = (u: RollUser | null | undefined) => /^Bot #\d+$/.test(u?.name ?? u?.displayName ?? "") || /chicken-bot-avatar/.test(u?.avatar ?? "");

export function handleBattleUpdated(payload: unknown, at: Date, ctx: AdapterContext) {
  const b = (payload as { battleUpdated?: { battle?: Battle } })?.battleUpdated?.battle;
  if (!b?.id || b.status !== "FINISHED") return;
  const roundId = b.id;
  if (settled.has(roundId)) return;
  if (settled.size > 5000) settled.clear();
  settled.add(roundId);

  const cost = b.costOriginal ?? {};
  const currency = cost?.currency ?? "TKN";
  if (currency === "BOX_KEY") {
    ctx.log.debug({ battleId: roundId }, "battle paid in box keys, not settled");
    return;
  }
  const seats = b.players ?? [];
  const winners = seats.filter((p) => p.won === true).length;
  const pulled = b.totalPulled ?? {};
  const pot = usd(pulled?.amount, pulled?.currency ?? "USD");
  const share = winners ? pot / winners : 0;
  const seatCost = Number(cost?.amount) || 0;
  const sponsor = Math.min(100, Math.max(0, Number(b.sponsorship?.percentage) || 0)) / 100;
  const creator = b.creatorId ?? null;
  const boxes = (b.rounds ?? []).flatMap((r) => (r.steps ?? []).map((s) => s.preselectedStepOption?.box?.name ?? null));

  seats.forEach((p, index) => {
    if (!p.user) return;
    const bot = isBot(p.user);
    const playerId = seen(p.user, at, ctx, bot);
    if (!playerId) return;
    const own = playerId === creator;
    // The creator covers the sponsored part of every other seat.
    const stake = own ? seatCost + seatCost * sponsor * (seats.length - 1) : seatCost * (1 - sponsor);
    const won = p.won === true;
    const payout = won ? share : 0;
    ctx.sink.bet({
      site: SITE,
      game: "battles",
      externalId: `${roundId}:${index}`,
      roundId,
      playerId,
      isHouse: bot,
      wageredUsd: usd(stake, currency),
      payoutUsd: Math.round(payout * 10000) / 10000,
      won: payout > usd(stake, currency),
      placedAt: b.createdAt ? new Date(b.createdAt) : at,
      settledAt: at,
      meta: {
        position: index,
        configuration: b.playerConfiguration?.[0] ?? null,
        seats: b.totalPlayers ?? seats.length,
        mode: b.winCriterionName ?? null,
        grouping: b.winCriterion?.grouping ?? null,
        seatUsd: usd(seatCost, currency),
        sponsorPercent: sponsor * 100,
        potUsd: pot,
        potCurrency: pulled?.currency ?? null,
        winners,
        boxes: boxes.length,
        rounds: (b.rounds ?? []).length,
        cashoutEnabled: Boolean(b.isCashoutEnabled),
        private: Boolean(b.private),
        engine: b.gameEngine ?? null,
        tags: b.tags ?? [],
        currency,
        ...(knownCurrency(currency) ? {} : { currencyUnknown: true }),
        ...(winners > 1 ? { splitAssumed: true } : {}),
      },
    });
  });
}
