/**
 * The Telegram message for one alert, shared by the collector (real bets)
 * and the dashboard (the per-rule "Test" button), so a test looks exactly
 * like the real thing. Telegram HTML parse mode.
 */
export type AlertKind = "big_bet" | "player_bet" | "big_win";

export type AlertBet = { site: string; game: string; playerId: string; playerName: string; wageredUsd: number; payoutUsd: number; won: boolean | null };

export const SITE_NAMES: Record<string, string> = {
  rustypot: "Rustypot", clash: "Clash.gg", rustclash: "RustClash", rustyloot: "Rustyloot", cases: "Cases.gg", rusteasy: "RustEasy", csgogem: "CSGOGem",
  banditcamp: "Bandit.camp", csgoroll: "CSGORoll", rustmagic: "RustMagic", splits: "Splits.gg", rustbattle: "RustBattle",
};
export const KIND_LABEL: Record<AlertKind, string> = { big_bet: "Big bet", player_bet: "Player bet", big_win: "Big win" };

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");

export function formatAlert(rule: { kind: AlertKind; name: string }, b: AlertBet, opts: { webUrl?: string | null; test?: boolean } = {}): string {
  const net = b.payoutUsd - b.wageredUsd;
  const result = b.won == null && net === 0 ? "pushed" : net >= 0 ? `won ${usd(b.payoutUsd)} (+${usd(net)})` : `lost ${usd(-net)}`;
  const webUrl = opts.webUrl?.replace(/\/$/, "");
  const profile = webUrl ? `\n<a href="${webUrl}/player/${b.site}/${encodeURIComponent(b.playerId)}">Open profile</a>` : "";
  return (
    (opts.test ? "🧪 <i>Test alert. A real one looks like this.</i>\n\n" : "") +
    `🎲 <b>${esc(KIND_LABEL[rule.kind])}</b> · ${esc(rule.name)}\n` +
    `<b>${esc(b.playerName)}</b> wagered <b>${usd(b.wageredUsd)}</b> on ${esc(title(b.game))} at ${esc(SITE_NAMES[b.site] ?? title(b.site))}\n` +
    `Result: ${esc(result)}` +
    profile
  );
}
