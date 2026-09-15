/**
 * Batched writer. Everything the adapters produce lands here, is buffered in
 * memory, and flushed as multi-row statements every FLUSH_MS or when a buffer
 * reaches FLUSH_ROWS. All writes are idempotent upserts so replays after a
 * reconnect or a reparse are harmless.
 */
import { sql, type Db } from "@casino/db";
import { log } from "./log.js";

const FLUSH_MS = 1000;
const FLUSH_ROWS = 500;

export type RawEventRow = { site: string; event: string; payload: unknown; receivedAt: Date };
export type PlayerRow = {
  site: string;
  externalId: string;
  displayName?: string | null;
  avatar?: string | null;
  isHouse?: boolean;
  seenAt: Date;
};
export type BetRow = {
  site: string;
  game: string;
  externalId: string;
  roundId?: string | null;
  playerId: string;
  isHouse?: boolean;
  wageredUsd: number;
  payoutUsd: number;
  won?: boolean | null;
  placedAt: Date;
  settledAt?: Date | null;
  meta?: unknown;
};
export type CoinflipRow = {
  site: string;
  externalId: string;
  createdAt: Date;
  status: string;
  hash?: string | null;
  creatorId?: string | null;
  creatorPick?: number | null;
  creatorTotal?: number | null;
  opponentId?: string | null;
  opponentTotal?: number | null;
  houseInvolved?: boolean;
  winnerId?: string | null;
  winnerHouse?: boolean;
  winningSide?: number | null;
  potUsd?: number | null;
  taxUsd?: number | null;
  houseNetUsd?: number | null;
  settledAt?: Date | null;
  meta?: unknown;
};
export type JackpotRow = {
  site: string;
  externalId: string;
  createdAt: Date;
  status: string;
  hash?: string | null;
  potUsd?: number | null;
  entries?: number | null;
  winnerId?: string | null;
  winnerHouse?: boolean;
  winnerTicket?: number | null;
  taxUsd?: number | null;
  houseNetUsd?: number | null;
  settledAt?: Date | null;
  meta?: unknown;
};
export type JackpotEntryRow = {
  site: string;
  jackpotId: string;
  playerId: string;
  amountUsd: number;
  items?: unknown;
  depositedAt: Date;
};

const j = (v: unknown) => JSON.stringify(v ?? null);

export class Sink {
  private raw: RawEventRow[] = [];
  private players = new Map<string, PlayerRow>();
  private bets = new Map<string, BetRow>();
  private coinflips = new Map<string, CoinflipRow>();
  private jackpots = new Map<string, JackpotRow>();
  private jackpotEntries = new Map<string, JackpotEntryRow>();
  /** Coinflip lobbies withdrawn before a flip: site|externalId. */
  private removed = new Set<string>();
  private timer: NodeJS.Timeout;
  private flushing: Promise<void> = Promise.resolve();
  readonly recordRaw: boolean;
  /** Buffer and count, but never write. Used by the legacy backfill's dry run. */
  readonly dryRun: boolean;
  /** Rows handed to doFlush so far, per table, and failed statements. */
  readonly counts = { raw: 0, players: 0, bets: 0, coinflips: 0, jackpots: 0, jackpotEntries: 0, errors: 0 };
  /** Last failed statement, for callers that want to stop instead of carrying on. */
  lastError: { table: string; err: unknown } | null = null;

  constructor(private db: Db, opts: { recordRaw?: boolean; dryRun?: boolean } = {}) {
    this.recordRaw = opts.recordRaw ?? true;
    this.dryRun = opts.dryRun ?? false;
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref();
  }

  rawEvent(row: RawEventRow) {
    if (!this.recordRaw) return;
    this.raw.push(row);
    if (this.raw.length >= FLUSH_ROWS) void this.flush();
  }
  player(row: PlayerRow) {
    const k = `${row.site}|${row.externalId}`;
    const prev = this.players.get(k);
    this.players.set(k, { ...prev, ...row, isHouse: row.isHouse || prev?.isHouse || false });
  }
  bet(row: BetRow) {
    this.bets.set(`${row.site}|${row.game}|${row.externalId}`, row);
  }
  coinflip(row: CoinflipRow) {
    const k = `${row.site}|${row.externalId}`;
    this.coinflips.set(k, { ...this.coinflips.get(k), ...row });
  }
  /**
   * Mark a lobby as removed without knowing its created_at (part of the
   * key). Applied as an UPDATE; a lobby we never saw is simply skipped.
   */
  coinflipRemoved(site: string, externalId: string) {
    this.removed.add(`${site}|${externalId}`);
  }
  jackpot(row: JackpotRow) {
    const k = `${row.site}|${row.externalId}`;
    this.jackpots.set(k, { ...this.jackpots.get(k), ...row });
  }
  jackpotEntry(row: JackpotEntryRow) {
    this.jackpotEntries.set(`${row.site}|${row.jackpotId}|${row.playerId}|${row.depositedAt.toISOString()}`, row);
  }

  /** Serialized: a flush never overlaps a previous one. Never rejects; failures are counted and logged. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(() => this.doFlush()).catch((e) => log.error({ err: e }, "flush failed"));
    return this.flushing;
  }

  /**
   * Each table is written in its own statement and its own try/catch, so one
   * bad row (or one table's constraint) cannot take the other tables' rows
   * down with it. The failed rows are dropped and the error logged with the
   * table name and the first row of the batch for diagnosis.
   */
  private async write(table: string, rows: unknown[], stmt: () => Promise<unknown>) {
    try {
      await stmt();
    } catch (err) {
      this.counts.errors++;
      this.lastError = { table, err };
      log.error({ err, table, rows: rows.length, sample: rows[0] }, "flush failed for table");
    }
  }

  async close() {
    clearInterval(this.timer);
    await this.flush();
  }

  private async doFlush() {
    const raw = this.raw.splice(0);
    const players = [...this.players.values()];
    this.players.clear();
    const bets = [...this.bets.values()];
    this.bets.clear();
    const coinflips = [...this.coinflips.values()];
    this.coinflips.clear();
    const jackpots = [...this.jackpots.values()];
    this.jackpots.clear();
    const entries = [...this.jackpotEntries.values()];
    this.jackpotEntries.clear();
    const removed = [...this.removed].map((k) => k.split("|") as [string, string]);
    this.removed.clear();
    this.counts.raw += raw.length;
    this.counts.players += players.length;
    this.counts.bets += bets.length;
    this.counts.coinflips += coinflips.length;
    this.counts.jackpots += jackpots.length;
    this.counts.jackpotEntries += entries.length;
    if (this.dryRun) return;

    if (raw.length) {
      // Some events carry no payload ("FG reset"); store JSON null rather than violating NOT NULL.
      await this.write("raw_events", raw, () => this.db.execute(sql`
        INSERT INTO raw_events (site, event, payload, received_at)
        SELECT site, event, COALESCE(payload, 'null'::jsonb), received_at FROM json_to_recordset(${j(raw.map((r) => ({ site: r.site, event: r.event, payload: r.payload, received_at: r.receivedAt })))}::json)
          AS x(site text, event text, payload jsonb, received_at timestamptz)`));
    }
    if (players.length) {
      await this.write("players", players, () => this.db.execute(sql`
        INSERT INTO players (site, external_id, display_name, avatar, is_house, first_seen, last_seen)
        SELECT site, external_id, display_name, avatar, is_house, seen_at, seen_at FROM json_to_recordset(${j(
          players.map((p) => ({ site: p.site, external_id: p.externalId, display_name: p.displayName ?? null, avatar: p.avatar ?? null, is_house: p.isHouse ?? false, seen_at: p.seenAt })),
        )}::json) AS x(site text, external_id text, display_name text, avatar text, is_house boolean, seen_at timestamptz)
        ON CONFLICT (site, external_id) DO UPDATE SET
          display_name = COALESCE(EXCLUDED.display_name, players.display_name),
          avatar       = COALESCE(EXCLUDED.avatar, players.avatar),
          is_house     = players.is_house OR EXCLUDED.is_house,
          first_seen   = LEAST(players.first_seen, EXCLUDED.first_seen),
          last_seen    = GREATEST(players.last_seen, EXCLUDED.last_seen)`));
    }
    if (coinflips.length) {
      await this.write("coinflips", coinflips, () => this.db.execute(sql`
        INSERT INTO coinflips (site, external_id, created_at, status, hash, creator_id, creator_pick, creator_total,
          opponent_id, opponent_total, house_involved, winner_id, winner_house, winning_side, pot_usd, tax_usd, house_net_usd, settled_at, updated_at, meta)
        SELECT site, external_id, created_at, status, hash, creator_id, creator_pick, creator_total,
          opponent_id, opponent_total, house_involved, winner_id, winner_house, winning_side, pot_usd, tax_usd, house_net_usd, settled_at, now(), meta
        FROM json_to_recordset(${j(
          coinflips.map((c) => ({
            site: c.site, external_id: c.externalId, created_at: c.createdAt, status: c.status, hash: c.hash ?? null,
            creator_id: c.creatorId ?? null, creator_pick: c.creatorPick ?? null, creator_total: c.creatorTotal ?? null,
            opponent_id: c.opponentId ?? null, opponent_total: c.opponentTotal ?? null, house_involved: c.houseInvolved ?? false,
            winner_id: c.winnerId ?? null, winner_house: c.winnerHouse ?? false, winning_side: c.winningSide ?? null, pot_usd: c.potUsd ?? null, tax_usd: c.taxUsd ?? null,
            house_net_usd: c.houseNetUsd ?? null, settled_at: c.settledAt ?? null, meta: c.meta ?? null,
          })),
        )}::json) AS x(site text, external_id text, created_at timestamptz, status text, hash text, creator_id text, creator_pick int,
          creator_total numeric, opponent_id text, opponent_total numeric, house_involved boolean, winner_id text, winner_house boolean, winning_side int,
          pot_usd numeric, tax_usd numeric, house_net_usd numeric, settled_at timestamptz, meta jsonb)
        ON CONFLICT (site, external_id, created_at) DO UPDATE SET
          -- "Ended" is final: the site also emits RemoveLobby after a flip finishes.
          status         = CASE WHEN coinflips.status = 'Ended' THEN coinflips.status ELSE EXCLUDED.status END,
          hash           = COALESCE(EXCLUDED.hash, coinflips.hash),
          creator_id     = COALESCE(EXCLUDED.creator_id, coinflips.creator_id),
          creator_pick   = COALESCE(EXCLUDED.creator_pick, coinflips.creator_pick),
          creator_total  = COALESCE(EXCLUDED.creator_total, coinflips.creator_total),
          opponent_id    = COALESCE(EXCLUDED.opponent_id, coinflips.opponent_id),
          opponent_total = COALESCE(EXCLUDED.opponent_total, coinflips.opponent_total),
          house_involved = coinflips.house_involved OR EXCLUDED.house_involved,
          winner_id      = COALESCE(EXCLUDED.winner_id, coinflips.winner_id),
          winner_house   = coinflips.winner_house OR EXCLUDED.winner_house,
          winning_side   = COALESCE(EXCLUDED.winning_side, coinflips.winning_side),
          pot_usd        = COALESCE(EXCLUDED.pot_usd, coinflips.pot_usd),
          tax_usd        = COALESCE(EXCLUDED.tax_usd, coinflips.tax_usd),
          house_net_usd  = COALESCE(EXCLUDED.house_net_usd, coinflips.house_net_usd),
          settled_at     = COALESCE(EXCLUDED.settled_at, coinflips.settled_at),
          updated_at     = now(),
          meta           = COALESCE(EXCLUDED.meta, coinflips.meta)`));
    }
    if (removed.length) {
      await this.write("coinflips(removed)", removed, () => this.db.execute(sql`
        UPDATE coinflips c SET status = 'Removed', updated_at = now()
        FROM json_to_recordset(${j(removed.map(([site, id]) => ({ site, external_id: id })))}::json) AS x(site text, external_id text)
        WHERE c.site = x.site AND c.external_id = x.external_id AND c.status <> 'Ended'`));
    }
    if (jackpots.length) {
      await this.write("jackpots", jackpots, () => this.db.execute(sql`
        INSERT INTO jackpots (site, external_id, created_at, status, hash, pot_usd, entries, winner_id, winner_house, winner_ticket, tax_usd, house_net_usd, settled_at, updated_at, meta)
        SELECT site, external_id, created_at, status, hash, pot_usd, entries, winner_id, winner_house, winner_ticket, tax_usd, house_net_usd, settled_at, now(), meta
        FROM json_to_recordset(${j(
          jackpots.map((c) => ({
            site: c.site, external_id: c.externalId, created_at: c.createdAt, status: c.status, hash: c.hash ?? null,
            pot_usd: c.potUsd ?? null, entries: c.entries ?? null, winner_id: c.winnerId ?? null, winner_house: c.winnerHouse ?? false, winner_ticket: c.winnerTicket ?? null,
            tax_usd: c.taxUsd ?? null, house_net_usd: c.houseNetUsd ?? null, settled_at: c.settledAt ?? null, meta: c.meta ?? null,
          })),
        )}::json) AS x(site text, external_id text, created_at timestamptz, status text, hash text, pot_usd numeric, entries int,
          winner_id text, winner_house boolean, winner_ticket numeric, tax_usd numeric, house_net_usd numeric, settled_at timestamptz, meta jsonb)
        ON CONFLICT (site, external_id, created_at) DO UPDATE SET
          status        = EXCLUDED.status,
          hash          = COALESCE(EXCLUDED.hash, jackpots.hash),
          pot_usd       = COALESCE(EXCLUDED.pot_usd, jackpots.pot_usd),
          entries       = COALESCE(EXCLUDED.entries, jackpots.entries),
          winner_id     = COALESCE(EXCLUDED.winner_id, jackpots.winner_id),
          winner_house  = jackpots.winner_house OR EXCLUDED.winner_house,
          winner_ticket = COALESCE(EXCLUDED.winner_ticket, jackpots.winner_ticket),
          tax_usd       = COALESCE(EXCLUDED.tax_usd, jackpots.tax_usd),
          house_net_usd = COALESCE(EXCLUDED.house_net_usd, jackpots.house_net_usd),
          settled_at    = COALESCE(EXCLUDED.settled_at, jackpots.settled_at),
          updated_at    = now(),
          meta          = COALESCE(EXCLUDED.meta, jackpots.meta)`));
    }
    if (entries.length) {
      await this.write("jackpot_entries", entries, () => this.db.execute(sql`
        INSERT INTO jackpot_entries (site, jackpot_id, player_id, amount_usd, items, deposited_at)
        SELECT * FROM json_to_recordset(${j(
          entries.map((e) => ({ site: e.site, jackpot_id: e.jackpotId, player_id: e.playerId, amount_usd: e.amountUsd, items: e.items ?? null, deposited_at: e.depositedAt })),
        )}::json) AS x(site text, jackpot_id text, player_id text, amount_usd numeric, items jsonb, deposited_at timestamptz)
        ON CONFLICT DO NOTHING`));
    }
    if (bets.length) {
      await this.write("bets", bets, () => this.db.execute(sql`
        INSERT INTO bets (site, game, external_id, round_id, player_id, is_house, wagered_usd, payout_usd, won, placed_at, settled_at, meta)
        SELECT * FROM json_to_recordset(${j(
          bets.map((b) => ({
            site: b.site, game: b.game, external_id: b.externalId, round_id: b.roundId ?? null, player_id: b.playerId,
            is_house: b.isHouse ?? false, wagered_usd: b.wageredUsd, payout_usd: b.payoutUsd, won: b.won ?? null,
            placed_at: b.placedAt, settled_at: b.settledAt ?? null, meta: b.meta ?? null,
          })),
        )}::json) AS x(site text, game text, external_id text, round_id text, player_id text, is_house boolean,
          wagered_usd numeric, payout_usd numeric, won boolean, placed_at timestamptz, settled_at timestamptz, meta jsonb)
        ON CONFLICT (site, game, external_id, placed_at) DO UPDATE SET
          payout_usd = EXCLUDED.payout_usd,
          won        = EXCLUDED.won,
          settled_at = COALESCE(EXCLUDED.settled_at, bets.settled_at),
          is_house   = EXCLUDED.is_house,
          meta       = COALESCE(EXCLUDED.meta, bets.meta)`));
    }

    const n = raw.length + players.length + bets.length + coinflips.length + jackpots.length + entries.length;
    if (n) log.debug({ raw: raw.length, players: players.length, bets: bets.length, coinflips: coinflips.length, jackpots: jackpots.length }, "flushed");
  }
}
