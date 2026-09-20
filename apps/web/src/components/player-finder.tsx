"use client";

import * as React from "react";
import { useTransition } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CasinoLogo } from "@/components/casino-logo";
import { PlayerAvatar } from "@/components/player-link";
import { TimeAgo } from "@/components/time-ago";
import { CASINOS, GAME_LABELS, getCasinoMeta } from "@/lib/casinos";
import { moneyShort } from "@/lib/format";
import { PLAYER_SORTS, type FoundPlayer, type PlayerFilters, type PlayerSort } from "@/lib/alerts-shared";
import { findPlayersAction } from "@/app/alerts/actions";
import { cn } from "@/lib/utils";

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn("h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent px-2.5 text-sm transition-[color,border-color,box-shadow] duration-150 ease-out outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&>option]:bg-popover", className)}
      {...props}
    />
  );
}

/**
 * Search players across sites and hand one back. Filters run on the server
 * over the last 30 days; typing is debounced so each keystroke does not
 * become a query.
 */
export function PlayerFinder({ initialSite, onPick }: { initialSite?: string | null; onPick: (p: FoundPlayer) => void }) {
  const [open, setOpen] = React.useState(false);
  const [filters, setFilters] = React.useState<PlayerFilters>({ site: initialSite ?? null, q: "", game: null, minAvgBet: null, sort: "wagered" });
  const [results, setResults] = React.useState<FoundPlayer[] | null>(null);
  const [pending, start] = useTransition();
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = React.useCallback((f: PlayerFilters) => start(async () => setResults(await findPlayersAction(f))), []);
  const update = (patch: Partial<PlayerFilters>, debounce = false) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (timer.current) clearTimeout(timer.current);
    if (debounce) timer.current = setTimeout(() => run(next), 300);
    else run(next);
  };
  React.useEffect(() => {
    if (open && results === null) run(filters);
  }, [open, results, filters, run]);

  const games = Object.entries(GAME_LABELS).sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Search data-icon="inline-start" className="size-3.5" strokeWidth={2} />Find player
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>Find a player</SheetTitle>
          <SheetDescription>Last 30 days across every tracked site. Pick one to fill the alert in.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 border-b p-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs font-medium">Search</span>
            <Input value={filters.q} onChange={(e) => update({ q: e.target.value }, true)} placeholder="Name or player id" autoFocus />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Site</span>
            <Select value={filters.site ?? ""} onChange={(e) => update({ site: e.target.value || null })}>
              <option value="">Any site</option>
              {CASINOS.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Favourite game</span>
            <Select value={filters.game ?? ""} onChange={(e) => update({ game: e.target.value || null })}>
              <option value="">Any game</option>
              {games.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Minimum average bet</span>
            <Input inputMode="decimal" placeholder="$0" className="tabular-nums" value={filters.minAvgBet ?? ""} onChange={(e) => update({ minAvgBet: Number(e.target.value.replace(/[$,\s]/g, "")) || null }, true)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Sort by</span>
            <Select value={filters.sort} onChange={(e) => update({ sort: e.target.value as PlayerSort })}>
              {(Object.keys(PLAYER_SORTS) as PlayerSort[]).map((k) => <option key={k} value={k}>{PLAYER_SORTS[k]}</option>)}
            </Select>
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-busy={pending}>
          {results === null || (pending && !results.length) ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">No players match. Loosen a filter or check the spelling.</p>
          ) : (
            <ul className={cn("flex flex-col gap-1 transition-[opacity] duration-150 ease-out", pending && "opacity-60")}>
              {results.map((p) => {
                const m = getCasinoMeta(p.site);
                return (
                  <li key={`${p.site}:${p.id}`}>
                    <button
                      type="button"
                      onClick={() => { onPick(p); setOpen(false); }}
                      className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-sm px-2 py-2 text-left transition-[background-color,scale] duration-150 ease-out hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none active:scale-[0.98]"
                    >
                      <PlayerAvatar name={p.handle} avatar={p.avatar} color={m?.color ?? "#888"} size={30} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{p.handle}</span>
                        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          {m ? <CasinoLogo casino={m} size={12} className="rounded-sm" /> : null}
                          {m?.name ?? p.site} · {p.favorite || "no game"} · active <TimeAgo iso={p.lastActive} />
                        </span>
                      </span>
                      <span className="text-right tabular-nums">
                        <span className="block text-sm font-medium">{moneyShort(p.wagered)}</span>
                        <span className="block text-[11px] text-muted-foreground">{moneyShort(p.avgBet)} avg · {p.bets.toLocaleString("en-US")} bets</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
