// Note: postgres.js with prepare=false cannot serialize Date params, so timestamps go over as ISO strings.
import { sql, type Db } from "@casino/db";
import { log } from "./log.js";

export class StatusReporter {
  private reconnects = 0;
  private lastEventAt: Date | null = null;
  private connected = false;
  private lastError: string | null = null;
  private timer: NodeJS.Timeout;

  constructor(private db: Db, private site: string) {
    this.timer = setInterval(() => void this.write(), 30_000);
    this.timer.unref();
  }
  onConnect() {
    this.connected = true;
    this.reconnects += 1;
    void this.write(new Date());
  }
  onDisconnect(reason: string) {
    this.connected = false;
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
    this.connected = false;
    await this.write();
  }
  private async write(connectAt?: Date) {
    try {
      await this.db.execute(sql`
        INSERT INTO collector_status (site, connected, last_event_at, last_connect_at, reconnects, last_error, updated_at)
        VALUES (${this.site}, ${this.connected}, ${this.lastEventAt?.toISOString() ?? null}::timestamptz, ${connectAt?.toISOString() ?? null}::timestamptz, ${Math.max(0, this.reconnects - 1)}, ${this.lastError}, now())
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
