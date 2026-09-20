import { CASINOS, gameLabel } from "./casinos";

export type AlertBot = { botUsername: string | null; chatId: string | null; chatTitle: string | null; connectedAt: string | null; lastError: string | null; createdAt: string };
export type RuleKind = "big_bet" | "player_bet" | "big_win";
export type AlertRule = {
  id: number; name: string; kind: RuleKind; site: string | null; game: string | null; playerId: string | null; playerName: string | null;
  minWagered: number | null; minNetWin: number | null; cooldownSeconds: number; enabled: boolean; createdAt: string; lastFiredAt: string | null; firedCount: number;
};

export const KIND_LABELS: Record<RuleKind, { label: string; hint: string }> = {
  big_bet: { label: "Big bet", hint: "Any bet at or above a size, on one site or all of them." },
  player_bet: { label: "Player bet", hint: "Every bet by one account, optionally only above a size." },
  big_win: { label: "Big win", hint: "Any bet whose net win reaches a size." },
};

/** Human description of a rule for the list. */
export function describeRule(r: AlertRule): string {
  const site = r.site ? CASINOS.find((c) => c.slug === r.site)?.name ?? r.site : "any site";
  const game = r.game ? ` on ${gameLabel(r.game)}` : "";
  const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  switch (r.kind) {
    case "big_bet": return `Any bet of ${usd(r.minWagered ?? 0)} or more${game} at ${site}`;
    case "player_bet": return `${r.playerName ?? r.playerId ?? "a player"} bets${r.minWagered ? ` ${usd(r.minWagered)} or more` : ""}${game} at ${site}`;
    case "big_win": return `Any net win of ${usd(r.minNetWin ?? 0)} or more${game} at ${site}`;
  }
}
