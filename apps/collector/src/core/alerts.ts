/**
 * Telegram alerts. Users register their own bot and write rules on the
 * dashboard (alert_bots, alert_rules); this evaluates every settled bet the
 * sink writes against the enabled rules and sends matches through the
 * owner's bot. Rules and bots are reloaded every 30 seconds. A delivery row
 * per (rule, bet) makes sends idempotent across re-flushes and restarts; a
 * rule's cooldown holds further sends for that many seconds after one.
 */
import { decryptSecret, formatAlert, sql, type Db } from "@casino/db";
import type { BetRow } from "./sink.js";
import { log } from "./log.js";

type Rule = {
  id: number;
  steamId: string;
  name: string;
  kind: "big_bet" | "player_bet" | "big_win";
  site: string | null;
  game: string | null;
  playerId: string | null;
  minWagered: number | null;
  minNetWin: number | null;
  cooldownSeconds: number;
  lastFiredAt: number;
  token: string;
  chatId: string;
};

export class Alerts {
  private rules: Rule[] = [];
  private names = new Map<string, { name: string; at: number }>();
  private timer: NodeJS.Timeout;
  private queue: Promise<void> = Promise.resolve();

  constructor(private db: Db, private webUrl = process.env.PUBLIC_WEB_URL?.replace(/\/$/, "")) {
    void this.load();
    this.timer = setInterval(() => void this.load(), 30_000);
    this.timer.unref();
  }

  async load() {
    try {
      const rows = (await this.db.execute(sql`
        SELECT r.id, r.steam_id, r.name, r.kind, r.site, r.game, r.player_id, r.min_wagered, r.min_net_win, r.cooldown_seconds, r.last_fired_at, b.token_enc, b.chat_id
        FROM alert_rules r JOIN alert_bots b ON b.steam_id = r.steam_id
        WHERE r.enabled AND b.chat_id IS NOT NULL`)) as unknown as Record<string, unknown>[];
      const next: Rule[] = [];
      for (const x of rows) {
        try {
          next.push({
            id: Number(x.id), steamId: String(x.steam_id), name: String(x.name), kind: x.kind as Rule["kind"], site: (x.site as string) ?? null, game: (x.game as string) ?? null,
            playerId: (x.player_id as string) ?? null, minWagered: x.min_wagered == null ? null : Number(x.min_wagered), minNetWin: x.min_net_win == null ? null : Number(x.min_net_win),
            cooldownSeconds: Number(x.cooldown_seconds) || 0, lastFiredAt: x.last_fired_at ? new Date(x.last_fired_at as string).getTime() : 0,
            token: decryptSecret(String(x.token_enc)), chatId: String(x.chat_id),
          });
        } catch (err) {
          log.warn({ err, rule: x.id }, "alert rule skipped: token cannot be decrypted");
        }
      }
      // Keep in-memory cooldown state across reloads.
      for (const r of next) { const prev = this.rules.find((p) => p.id === r.id); if (prev && prev.lastFiredAt > r.lastFiredAt) r.lastFiredAt = prev.lastFiredAt; }
      this.rules = next;
      if (Math.random() < 0.05) await this.db.execute(sql`DELETE FROM alert_deliveries WHERE sent_at < now() - interval '7 days'`);
    } catch (err) {
      log.warn({ err }, "alert rules could not be loaded");
    }
  }

  private matches(r: Rule, b: BetRow) {
    if (r.site && r.site !== b.site) return false;
    if (r.game && r.game !== b.game) return false;
    const net = b.payoutUsd - b.wageredUsd;
    switch (r.kind) {
      case "big_bet": return r.minWagered != null && b.wageredUsd >= r.minWagered;
      case "player_bet": return r.playerId === b.playerId && (r.minWagered == null || b.wageredUsd >= r.minWagered);
      case "big_win": return r.minNetWin != null && net >= r.minNetWin;
    }
  }

  /** Called by the sink after a batch of bets is written. */
  onBets(bets: BetRow[]) {
    if (!this.rules.length) return;
    const now = Date.now();
    for (const b of bets) {
      if (!b.settledAt || b.isHouse) continue;
      for (const r of this.rules) {
        if (!this.matches(r, b)) continue;
        if (r.cooldownSeconds && now - r.lastFiredAt < r.cooldownSeconds * 1000) continue;
        r.lastFiredAt = now;
        this.queue = this.queue.then(() => this.deliver(r, b)).catch((err) => log.warn({ err, rule: r.id }, "alert delivery failed"));
      }
    }
  }

  private async playerName(site: string, id: string) {
    const k = `${site}|${id}`;
    const c = this.names.get(k);
    if (c && Date.now() - c.at < 600_000) return c.name;
    const r = (await this.db.execute(sql`SELECT display_name FROM players WHERE site = ${site} AND external_id = ${id}`)) as unknown as { display_name: string | null }[];
    const name = r[0]?.display_name || id;
    this.names.set(k, { name, at: Date.now() });
    return name;
  }

  private async deliver(r: Rule, b: BetRow) {
    const key = `${b.site}|${b.game}|${b.externalId}`;
    const ins = (await this.db.execute(sql`INSERT INTO alert_deliveries (rule_id, key) VALUES (${r.id}, ${key}) ON CONFLICT DO NOTHING RETURNING rule_id`)) as unknown as unknown[];
    if (!ins.length) return; // already sent for this bet
    const name = await this.playerName(b.site, b.playerId);
    const text = formatAlert(r, { site: b.site, game: b.game, playerId: b.playerId, playerName: name, wageredUsd: b.wageredUsd, payoutUsd: b.payoutUsd, won: b.won ?? null, roundId: b.roundId ?? null }, { webUrl: this.webUrl });
    const res = await fetch(`https://api.telegram.org/bot${r.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: r.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      await this.db.execute(sql`UPDATE alert_bots SET last_error = ${`${res.status} ${body.slice(0, 200)}`}, updated_at = now() WHERE steam_id = ${r.steamId}`);
      throw new Error(`telegram ${res.status}: ${body.slice(0, 120)}`);
    }
    await this.db.execute(sql`UPDATE alert_rules SET last_fired_at = now(), fired_count = fired_count + 1 WHERE id = ${r.id}`);
    await this.db.execute(sql`UPDATE alert_bots SET last_error = NULL, updated_at = now() WHERE steam_id = ${r.steamId} AND last_error IS NOT NULL`);
  }

  async close() {
    clearInterval(this.timer);
    await this.queue.catch(() => {});
  }
}
