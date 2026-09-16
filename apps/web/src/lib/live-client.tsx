"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CasinoData } from "@/components/views/casino";
import type { OverviewData } from "@/components/views/overview";
import type { BetRow, CoinflipRound, JackpotRound, LiveCasino, LiveOverview, Point, Range } from "@/lib/types";

/** Ticks are tiny (a few KB, a few ms of database), so every range polls at the same pace. */
export const LIVE_INTERVAL_MS = 3_000;
export const LIVE_KEY = "live";

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, gcTime: 5 * 60_000 } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function fetchLive<T>(params: Record<string, string>): Promise<T> {
  const res = await fetch(`/api/live?${new URLSearchParams(params)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`live fetch failed: ${res.status}`);
  return res.json();
}

/** Upsert the moving buckets into the series the page was rendered with and keep the window length. */
function mergeSeries(prev: Point[], tail: Point[], range: Range): Point[] {
  const byT = new Map(prev.map((p) => [p.t, p]));
  for (const p of tail) byT.set(p.t, p);
  const keep = range === 1 ? 25 : range;
  return [...byT.values()].sort((a, b) => a.t.localeCompare(b.t)).slice(-keep);
}

function mergeRounds<T extends { id: string }>(fresh: T[], prev: T[], limit = 25): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of [...fresh, ...prev]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

const newest = (flips: CoinflipRound[], pots: JackpotRound[], bets: BetRow[], fallback: string) =>
  [...flips, ...pots, ...bets].reduce((m, r) => (r.settledAt && r.settledAt > m ? r.settledAt : m), fallback);

/**
 * Keeps a casino page current. The server-rendered props seed the cache;
 * each tick asks only for today's buckets, the small aggregates and rounds
 * newer than the newest one we hold, then merges them in place.
 */
export function useLiveCasino(initial: CasinoData): CasinoData {
  const qc = useQueryClient();
  const key = [LIVE_KEY, "casino", initial.meta.slug, initial.range];
  const q = useQuery<CasinoData>({
    queryKey: key,
    enabled: initial.tracked && !!initial.summary,
    initialData: initial,
    initialDataUpdatedAt: Date.parse(initial.renderedAt),
    staleTime: LIVE_INTERVAL_MS,
    refetchInterval: LIVE_INTERVAL_MS,
    queryFn: async () => {
      const prev = qc.getQueryData<CasinoData>(key) ?? initial;
      const since = newest(prev.flips, prev.pots, prev.bets, prev.renderedAt);
      const t = await fetchLive<LiveCasino>({ site: initial.meta.slug, range: String(initial.range), since });
      return {
        ...prev,
        renderedAt: t.at,
        summary: t.summary,
        series: mergeSeries(prev.series, t.tail, prev.range),
        games: t.games,
        players: t.players,
        breakdown: t.breakdown,
        records: t.records,
        flips: mergeRounds(t.flips, prev.flips),
        pots: mergeRounds(t.pots, prev.pots),
        bets: mergeRounds(t.bets, prev.bets),
      };
    },
  });
  return q.data ?? initial;
}

export function useLiveOverview(initial: OverviewData): OverviewData {
  const qc = useQueryClient();
  const key = [LIVE_KEY, "overview", initial.range];
  const q = useQuery<OverviewData>({
    queryKey: key,
    initialData: initial,
    initialDataUpdatedAt: Date.parse(initial.renderedAt),
    staleTime: LIVE_INTERVAL_MS,
    refetchInterval: LIVE_INTERVAL_MS,
    queryFn: async () => {
      const prev = qc.getQueryData<OverviewData>(key) ?? initial;
      const t = await fetchLive<LiveOverview>({ site: "all", range: String(initial.range) });
      const series: Record<string, Point[]> = { ...prev.series };
      for (const [slug, tail] of Object.entries(t.siteTails)) series[slug] = mergeSeries(prev.series[slug] ?? [], tail, prev.range);
      return { ...prev, renderedAt: t.at, sites: t.sites, totals: t.totals, agg: mergeSeries(prev.agg, t.aggTail, prev.range), series, games: t.games, players: t.players };
    },
  });
  return q.data ?? initial;
}

/** Header indicator: whether a tick is in flight and when the last one landed. */
export function useLiveStatus() {
  const qc = useQueryClient();
  const [state, setState] = React.useState<{ fetching: boolean; updatedAt: number | null }>({ fetching: false, updatedAt: null });
  React.useEffect(
    () =>
      qc.getQueryCache().subscribe((e) => {
        if (e.query.queryKey[0] !== LIVE_KEY) return;
        if (e.type === "updated" && e.action.type === "fetch") setState((s) => ({ ...s, fetching: true }));
        if (e.type === "updated" && (e.action.type === "success" || e.action.type === "error")) setState({ fetching: false, updatedAt: e.action.type === "success" ? Date.now() : null });
      }),
    [qc],
  );
  const refresh = React.useCallback(() => qc.invalidateQueries({ queryKey: [LIVE_KEY] }), [qc]);
  return { ...state, refresh };
}
