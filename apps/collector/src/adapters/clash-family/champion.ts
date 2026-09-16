/**
 * Champion, channel "champion-match" (clash.gg): a king-of-the-hill fought
 * in rounds. Events are namespaced by match type, e.g.
 * `champion-match:NORMAL:round-update` (a new fight: the champion and the
 * challenger, each with the stake they entered with), `:attack` (blows),
 * `:queue-update`, and `:match-finish` when the session ends with `winner`
 * and `paidAmount`.
 *
 * Every entrant stakes their `amount` once, when they first appear in a
 * session; the session's last champion is paid `paidAmount` at the finish.
 * A session already running when we connect is missing its earlier entrants
 * and is skipped.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { type FamilySite, seen } from "./site.js";
import type { CgChampionFinish, CgChampionRound, CgChampionSide } from "./types.js";

type Session = { id: number; startedAt: Date; entrants: Map<string, { amount: number; currency: string; role: "champion" | "challenger" }> };

export function champion(site: FamilySite) {
  const sessions = new Map<number, Session>();

  const enter = (s: Session, side: CgChampionSide | undefined, role: "champion" | "challenger", at: Date, ctx: AdapterContext) => {
    if (!side?.user?.id) return;
    const pid = seen(site, side.user, at, ctx);
    if (!s.entrants.has(pid)) s.entrants.set(pid, { amount: Number(side.amount) || 0, currency: side.currency, role });
  };

  function onRound(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
    const r = payload as CgChampionRound;
    if (!r?.sessionId) return;
    let s = sessions.get(r.sessionId);
    if (!s) {
      s = { id: r.sessionId, startedAt: receivedAt, entrants: new Map() };
      sessions.set(r.sessionId, s);
    }
    enter(s, r.champion, "champion", receivedAt, ctx);
    enter(s, r.challenger, "challenger", receivedAt, ctx);
  }

  function onFinish(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
    const f = payload as CgChampionFinish;
    const s = f?.sessionId ? sessions.get(f.sessionId) : undefined;
    if (!s) return;
    sessions.delete(f.sessionId);
    const winnerId = f.winner?.userId != null ? String(f.winner.userId) : null;
    if (!winnerId) return;
    const paid = Number(f.paidAmount) || 0;
    const pot = [...s.entrants.values()].reduce((a, e) => a + e.amount, 0);
    // A payout above the stakes we saw means entrants joined before we connected: the session is incomplete.
    if (!s.entrants.has(winnerId) || paid > pot) {
      ctx.log.debug({ sessionId: f.sessionId, paid, pot, entrants: s.entrants.size }, "champion session incomplete, skipped");
      return;
    }
    const roundId = String(f.sessionId);
    for (const [pid, e] of s.entrants) {
      if (e.currency !== "REAL") continue;
      const won = pid === winnerId;
      ctx.sink.bet({
        site: site.slug,
        game: "champion",
        externalId: `${roundId}:${pid}`,
        roundId,
        playerId: pid,
        wageredUsd: site.usd(e.amount),
        payoutUsd: site.usd(won ? paid : 0),
        won,
        placedAt: s.startedAt,
        settledAt: receivedAt,
        meta: { role: e.role, entrants: s.entrants.size, paidCents: paid, matchType: f.type ?? null },
      });
    }
  }

  return { onRound, onFinish };
}
