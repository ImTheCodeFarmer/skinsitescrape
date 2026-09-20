/**
 * The Telegram message for one alert, shared by the collector (real bets)
 * and the dashboard (the per-rule "Test" button), so a test looks exactly
 * like the real thing. Telegram HTML parse mode.
 */
export type AlertKind = "big_bet" | "player_bet" | "big_win";

export type AlertBet = { site: string; game: string; playerId: string; playerName: string; wageredUsd: number; payoutUsd: number; won: boolean | null; roundId?: string | null };

/**
 * Per site and `bets.game`, the page for one round with `{id}` in place of
 * the round id. Games without one are not linked. The dashboard's site
 * metadata reads from here too, so alert links and table links agree.
 */
export const ROUND_URLS: Record<string, Record<string, string>> = {
  clash: { battles: "https://clash.gg/battles/{id}" },
  rustclash: { battles: "https://rustclash.com/battles/{id}" },
  rustyloot: { battles: "https://rustyloot.gg/battles/{id}" },
  cases: { battles: "https://cases.gg/case-battles/{id}" },
  rusteasy: { battles: "https://www.rusteasy.com/casebattles/{id}" },
  csgogem: { battles: "https://csgogem.com/games/battles/{id}" },
  banditcamp: { battles: "https://bandit.camp/crate-battles/{id}" },
  csgoroll: { battles: "https://www.csgoroll.com/battles/{id}" },
  rustbattle: { battles: "https://rustbattle.com/games/battles/{id}" },
  rustmagic: { battles: "https://rustmagic.com/case-battles/{id}" },
};

export function roundUrlFor(site: string, game: string, roundId: string | null | undefined): string | null {
  const tpl = roundId ? ROUND_URLS[site]?.[game] : undefined;
  return tpl ? tpl.replace("{id}", encodeURIComponent(roundId!)) : null;
}

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
  const links: string[] = [];
  const bet = roundUrlFor(b.site, b.game, b.roundId);
  if (bet) links.push(`<a href="${bet}">Open bet</a>`);
  if (webUrl) links.push(`<a href="${webUrl}/player/${b.site}/${encodeURIComponent(b.playerId)}">Open profile</a>`);
  const profile = links.length ? "\n" + links.join(" · ") : "";
  return (
    (opts.test ? "🧪 <i>Test alert. A real one looks like this.</i>\n\n" : "") +
    `🎲 <b>${esc(KIND_LABEL[rule.kind])}</b> · ${esc(rule.name)}\n` +
    `<b>${esc(b.playerName)}</b> wagered <b>${usd(b.wageredUsd)}</b> on ${esc(title(b.game))} at ${esc(SITE_NAMES[b.site] ?? title(b.site))}\n` +
    `Result: ${esc(result)}` +
    profile
  );
}
