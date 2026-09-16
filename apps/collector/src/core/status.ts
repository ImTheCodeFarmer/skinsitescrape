// Note: postgres.js with prepare=false cannot serialize Date params, so timestamps go over as ISO strings.
import { sql, type Db } from "@casino/db";
import { log } from "./log.js";

/**
 * One row per site. A site with several connections (cases.gg: main socket
 * plus crash socket) counts as connected only while all of them are up;
 * `conn` identifies the connection in the callbacks.
 */
export class StatusReporter {
  private connects = 0;
  private lastEventAt: Date | null = null;
  private up = new Set<number>();
  private lastError: string | null = null;
  private timer: NodeJS.Timeout;

  constructor(private db: Db, private site: string, private expected = 1) {
    this.timer = setInterval(() => void this.write(), 30_000);
    this.timer.unref();
  }
  private get connected() {
    return this.up.size >= this.expected;
  }
  onConnect(conn = 0) {
    this.up.add(conn);
    this.connects += 1;
    void this.write(new Date());
  }
  onDisconnect(reason: string, conn = 0) {
    this.up.delete(conn);
    this.lastError = reason;
    void this.write();
  }
  onError(msg: string) {
    this.lastError = msg;
  }
  onEvent() {
    this.lastEventAt = new Date();
  }
  async close() {
    clearInterval(this.timer);
    this.up.clear();
    await this.write();
  }
  private async write(connectAt?: Date) {
    try {
      await this.db.execute(sql`
        INSERT INTO collector_status (site, connected, last_event_at, last_connect_at, reconnects, last_error, updated_at)
        VALUES (${this.site}, ${this.connected}, ${this.lastEventAt?.toISOString() ?? null}::timestamptz, ${connectAt?.toISOString() ?? null}::timestamptz, ${Math.max(0, this.connects - this.expected)}, ${this.lastError}, now())
        ON CONFLICT (site) DO UPDATE SET
          connected       = EXCLUDED.connected,
          last_event_at   = COALESCE(EXCLUDED.last_event_at, collector_status.last_event_at),
          last_connect_at = COALESCE(EXCLUDED.last_connect_at, collector_status.last_connect_at),
          reconnects      = EXCLUDED.reconnects,
          last_error      = EXCLUDED.last_error,
          updated_at      = now()`);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err), site: this.site }, "status write failed");
    }
  }
}
