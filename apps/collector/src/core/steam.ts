/**
 * Steam profile enrichment. Works through every Steam-keyed player on a
 * schedule set by how active they are, under a global request budget, and
 * writes what Steam shows publicly to steam_profiles / steam_aliases.
 *
 * Sources, cheapest first:
 *  - ISteamUser/GetPlayerSummaries and GetPlayerBans (Web API, STEAM_API_KEY):
 *    100 profiles per request, so a hundred thousand players cost a
 *    thousand requests. Persona, picture, visibility, country, account age,
 *    bans.
 *  - The profile's XML (`?xml=1`, no key): one request per profile, used
 *    only when no API key is configured.
 *  - `/ajaxaliases/` (no key): the profile page's list of past names, the
 *    only place Steam exposes them. One request per profile, public
 *    profiles only.
 *  - ISteamUser/GetFriendList (key): one request per profile, public
 *    friends lists only, capped at 500 ids.
 *
 * Budget: STEAM_RPS requests per second across all sources (default 0.5)
 * and STEAM_DAILY_MAX per UTC day (default 15000), enforced with a token
 * bucket; batched requests count once. Per-profile work (aliases, friends)
 * is only done for players active in the last 30 days. Everything runs off
 * timers between socket events and never blocks the sink.
 */
import { sql, type Db } from "@casino/db";
import { log } from "./log.js";

const STEAM64 = /^7656119[0-9]{10}$/;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const AVATAR_HASH = /\/([0-9a-f]{40})(?:_full|_medium)?\.(?:jpg|png)/;

export type Tier = "hot" | "warm" | "cold";
/** Refresh interval per tier, and whether the per-profile extras (aliases, friends) are fetched. */
const TIERS: Record<Tier, { every: string; extras: boolean }> = {
  hot: { every: "2 days", extras: true },
  warm: { every: "7 days", extras: true },
  cold: { every: "30 days", extras: false },
};

type Summary = {
  steamid: string; personaname?: string; avatarfull?: string; profileurl?: string; communityvisibilitystate?: number;
  loccountrycode?: string; timecreated?: number; lastlogoff?: number;
};
type Ban = { SteamId: string; VACBanned?: boolean; NumberOfGameBans?: number };

export class SteamEnricher {
  private key = process.env.STEAM_API_KEY || null;
  private rps = Math.max(0.05, Number(process.env.STEAM_RPS) || 0.5);
  private dailyMax = Math.max(100, Number(process.env.STEAM_DAILY_MAX) || 15_000);
  private tokens = 1;
  private lastRefill = Date.now();
  private day = new Date().toISOString().slice(0, 10);
  private usedToday = 0;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(private db: Db, private batch = Number(process.env.STEAM_BATCH) || 100) {}

  start() {
    log.info({ api: Boolean(this.key), rps: this.rps, dailyMax: this.dailyMax }, "steam enrichment on");
    const tick = async () => {
      if (this.stopped) return;
      try {
        await this.runOnce();
      } catch (err) {
        log.warn({ err }, "steam enrichment tick failed");
      }
      if (!this.stopped) this.timer = setTimeout(tick, 60_000);
    };
    this.timer = setTimeout(tick, 15_000);
    this.timer.unref();
  }

  async close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  // ------------------------------------------------------------ budget
  private async take(): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) { this.day = today; this.usedToday = 0; }
    if (this.usedToday >= this.dailyMax) return false;
    const now = Date.now();
    this.tokens = Math.min(this.rps * 10, this.tokens + ((now - this.lastRefill) / 1000) * this.rps);
    this.lastRefill = now;
    if (this.tokens < 1) await new Promise((r) => setTimeout(r, ((1 - this.tokens) / this.rps) * 1000));
    this.tokens -= 1;
    this.usedToday += 1;
    return true;
  }

  private async get(url: string): Promise<Response | null> {
    if (!(await this.take())) return null;
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json, text/xml;q=0.9, */*;q=0.8" }, signal: AbortSignal.timeout(15_000) });
      if (res.status === 429) {
        log.warn("steam rate limited us, pausing 10 minutes");
        this.tokens = -this.rps * 600;
      }
      return res;
    } catch (err) {
      log.debug({ err, url: url.replace(/key=[^&]+/, "key=…") }, "steam request failed");
      return null;
    }
  }

  // ------------------------------------------------------------ scheduling
  /**
   * Steam ids due for a fetch: never fetched first (newest activity first),
   * then by next_fetch_at. Activity is the newest last_seen across the
   * player's Steam-keyed site rows, which also sets the tier.
   */
  private async due(limit: number): Promise<{ steamId: string; tier: Tier }[]> {
    const r = (await this.db.execute(sql`
      WITH ids AS (
        SELECT external_id AS steam_id, max(last_seen) AS last_seen
        FROM players WHERE external_id ~ '^7656119[0-9]{10}$' AND NOT is_house
        GROUP BY external_id
      )
      SELECT i.steam_id, i.last_seen,
             CASE WHEN i.last_seen >= now() - interval '7 days' THEN 'hot' WHEN i.last_seen >= now() - interval '30 days' THEN 'warm' ELSE 'cold' END AS tier
      FROM ids i LEFT JOIN steam_profiles sp ON sp.steam_id = i.steam_id
      WHERE sp.steam_id IS NULL OR sp.next_fetch_at <= now()
      ORDER BY (sp.steam_id IS NULL) DESC, i.last_seen DESC
      LIMIT ${limit}`)) as unknown as { steam_id: string; tier: Tier }[];
    return r.map((x) => ({ steamId: String(x.steam_id), tier: x.tier }));
  }

  /** One pass: a batch of due profiles through the cheapest source, then extras for the active ones. */
  async runOnce(limit = this.batch): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const list = await this.due(limit);
      if (!list.length) return 0;
      const tierOf = new Map(list.map((x) => [x.steamId, x.tier]));
      const ids = list.map((x) => x.steamId);
      const visible = new Map<string, boolean>();
      if (this.key) {
        for (let i = 0; i < ids.length; i += 100) {
          const chunk = ids.slice(i, i + 100);
          const [sums, bans] = await Promise.all([this.summaries(chunk), this.bans(chunk)]);
          if (!sums) { await this.markError(chunk, "summaries unavailable", tierOf); continue; }
          for (const id of chunk) {
            const s = sums.get(id);
            if (!s) { await this.markError([id], "not found", tierOf); continue; }
            const pub = s.communityvisibilitystate === 3;
            visible.set(id, pub);
            await this.upsert(id, {
              persona: s.personaname ?? null, avatar: s.avatarfull ?? null, avatarHash: s.avatarfull?.match(AVATAR_HASH)?.[1] ?? null, profileUrl: s.profileurl ?? null,
              vanity: s.profileurl?.match(/\/id\/([^/]+)/)?.[1] ?? null, visibility: pub ? "public" : s.communityvisibilitystate === 1 ? "private" : "friends",
              country: s.loccountrycode ?? null, createdAt: s.timecreated ? new Date(s.timecreated * 1000) : null, lastLogoff: s.lastlogoff ? new Date(s.lastlogoff * 1000) : null,
              vacBanned: bans?.get(id)?.VACBanned ?? null, gameBans: bans?.get(id)?.NumberOfGameBans ?? null, source: "api",
            }, tierOf.get(id)!);
          }
        }
      } else {
        for (const id of ids) {
          const x = await this.xml(id);
          if (!x) { await this.markError([id], "xml unavailable", tierOf); continue; }
          visible.set(id, x.visibility === "public");
          await this.upsert(id, { ...x, source: "xml" }, tierOf.get(id)!);
        }
      }
      // Extras for active, public profiles only.
      let extras = 0;
      for (const id of ids) {
        const tier = tierOf.get(id)!;
        if (!TIERS[tier].extras || !visible.get(id)) continue;
        await this.aliases(id);
        if (this.key) await this.friends(id);
        extras += 1;
      }
      log.info({ profiles: ids.length, extras, usedToday: this.usedToday }, "steam enrichment pass");
      return ids.length;
    } finally {
      this.running = false;
    }
  }

  // ------------------------------------------------------------ sources
  private async summaries(ids: string[]): Promise<Map<string, Summary> | null> {
    const res = await this.get(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${this.key}&steamids=${ids.join(",")}`);
    if (!res?.ok) return null;
    const j = (await res.json()) as { response?: { players?: Summary[] } };
    return new Map((j.response?.players ?? []).map((p) => [p.steamid, p]));
  }

  private async bans(ids: string[]): Promise<Map<string, Ban> | null> {
    const res = await this.get(`https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${this.key}&steamids=${ids.join(",")}`);
    if (!res?.ok) return null;
    const j = (await res.json()) as { players?: Ban[] };
    return new Map((j.players ?? []).map((b) => [b.SteamId, b]));
  }

  private async xml(id: string) {
    const res = await this.get(`https://steamcommunity.com/profiles/${id}/?xml=1`);
    if (!res?.ok) return null;
    const t = await res.text();
    const tag = (n: string) => { const m = t.match(new RegExp(`<${n}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${n}>`)); return m ? m[1].trim() : null; };
    if (!tag("steamID64")) return null;
    const avatar = tag("avatarFull");
    const since = tag("memberSince");
    return {
      persona: tag("steamID"), avatar, avatarHash: avatar?.match(AVATAR_HASH)?.[1] ?? null, profileUrl: `https://steamcommunity.com/profiles/${id}`, vanity: tag("customURL") || null,
      visibility: tag("privacyState") ?? "unknown", country: null, createdAt: since ? new Date(since) : null, lastLogoff: null,
      vacBanned: tag("vacBanned") === "1", gameBans: null,
    };
  }

  /** Past names from the profile page. `timechanged` has no year ("Mar 23 @ 7:14am"): a month/day in the future means last year. */
  private async aliases(id: string) {
    const res = await this.get(`https://steamcommunity.com/profiles/${id}/ajaxaliases/`);
    if (!res?.ok) return;
    let list: { newname?: string; timechanged?: string }[] = [];
    try { list = (await res.json()) as typeof list; } catch { return; }
    const now = new Date();
    const rows = list.filter((a) => a.newname).map((a) => {
      let at: Date | null = null;
      const m = a.timechanged?.match(/^([A-Za-z]{3}) (\d{1,2})(?:, (\d{4}))? @/);
      if (m) {
        at = new Date(`${m[1]} ${m[2]}, ${m[3] ?? now.getUTCFullYear()} 12:00:00Z`);
        if (!m[3] && at > now) at = new Date(`${m[1]} ${m[2]}, ${now.getUTCFullYear() - 1} 12:00:00Z`);
        if (Number.isNaN(at.getTime())) at = null;
      }
      return { name: a.newname!.slice(0, 120), at };
    });
    if (rows.length) {
      await this.db.execute(sql`
        INSERT INTO steam_aliases (steam_id, name, norm_name, seen_at)
        SELECT ${id}, name, norm_name(name), seen_at FROM json_to_recordset(${JSON.stringify(rows.map((r) => ({ name: r.name, seen_at: r.at?.toISOString() ?? null })))}::json) AS x(name text, seen_at timestamptz)
        ON CONFLICT (steam_id, name) DO UPDATE SET seen_at = GREATEST(steam_aliases.seen_at, EXCLUDED.seen_at)`);
    }
    await this.db.execute(sql`UPDATE steam_profiles SET aliases_fetched_at = now() WHERE steam_id = ${id}`);
  }

  private async friends(id: string) {
    const res = await this.get(`https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${this.key}&steamid=${id}&relationship=friend`);
    if (!res) return;
    if (res.status === 401) { await this.db.execute(sql`UPDATE steam_profiles SET friends = NULL, friends_count = NULL, friends_fetched_at = now() WHERE steam_id = ${id}`); return; }
    if (!res.ok) return;
    const j = (await res.json()) as { friendslist?: { friends?: { steamid: string }[] } };
    const all = (j.friendslist?.friends ?? []).map((f) => f.steamid).filter((s) => STEAM64.test(s));
    await this.db.execute(sql`UPDATE steam_profiles SET friends = ARRAY(SELECT json_array_elements_text(${JSON.stringify(all.slice(0, 500))}::json)), friends_count = ${all.length}, friends_fetched_at = now() WHERE steam_id = ${id}`);
  }

  // ------------------------------------------------------------ writes
  private async upsert(id: string, p: { persona: string | null; avatar: string | null; avatarHash: string | null; profileUrl: string | null; vanity: string | null; visibility: string; country: string | null; createdAt: Date | null; lastLogoff: Date | null; vacBanned: boolean | null; gameBans: number | null; source: string }, tier: Tier) {
    const every = TIERS[tier].every;
    await this.db.execute(sql`
      INSERT INTO steam_profiles (steam_id, persona, avatar, avatar_hash, profile_url, vanity, visibility, country, account_created_at, last_logoff_at, vac_banned, game_bans, fetched_at, next_fetch_at, fetch_count, fetch_error, source)
      VALUES (${id}, ${p.persona}, ${p.avatar}, ${p.avatarHash}, ${p.profileUrl}, ${p.vanity}, ${p.visibility}, ${p.country}, ${p.createdAt?.toISOString() ?? null}::timestamptz, ${p.lastLogoff?.toISOString() ?? null}::timestamptz, ${p.vacBanned}, ${p.gameBans}, now(), now() + ${every}::interval, 1, NULL, ${p.source})
      ON CONFLICT (steam_id) DO UPDATE SET
        persona = COALESCE(EXCLUDED.persona, steam_profiles.persona), avatar = COALESCE(EXCLUDED.avatar, steam_profiles.avatar), avatar_hash = COALESCE(EXCLUDED.avatar_hash, steam_profiles.avatar_hash),
        profile_url = COALESCE(EXCLUDED.profile_url, steam_profiles.profile_url), vanity = COALESCE(EXCLUDED.vanity, steam_profiles.vanity), visibility = EXCLUDED.visibility,
        country = COALESCE(EXCLUDED.country, steam_profiles.country), account_created_at = COALESCE(EXCLUDED.account_created_at, steam_profiles.account_created_at),
        last_logoff_at = COALESCE(EXCLUDED.last_logoff_at, steam_profiles.last_logoff_at), vac_banned = COALESCE(EXCLUDED.vac_banned, steam_profiles.vac_banned), game_bans = COALESCE(EXCLUDED.game_bans, steam_profiles.game_bans),
        fetched_at = now(), next_fetch_at = now() + ${every}::interval, fetch_count = steam_profiles.fetch_count + 1, fetch_error = NULL, source = EXCLUDED.source`);
    // The current persona is a name too.
    if (p.persona) {
      await this.db.execute(sql`INSERT INTO steam_aliases (steam_id, name, norm_name, seen_at) VALUES (${id}, ${p.persona.slice(0, 120)}, norm_name(${p.persona.slice(0, 120)}), now())
        ON CONFLICT (steam_id, name) DO UPDATE SET seen_at = now()`);
    }
  }

  /** A failed fetch is retried after a day so one bad response cannot pin the queue. */
  private async markError(ids: string[], error: string, tierOf: Map<string, Tier>) {
    for (const id of ids) {
      await this.db.execute(sql`
        INSERT INTO steam_profiles (steam_id, visibility, next_fetch_at, fetch_count, fetch_error)
        VALUES (${id}, 'unknown', now() + interval '1 day', 1, ${error})
        ON CONFLICT (steam_id) DO UPDATE SET next_fetch_at = now() + interval '1 day', fetch_count = steam_profiles.fetch_count + 1, fetch_error = ${error}`);
      void tierOf;
    }
  }
}
