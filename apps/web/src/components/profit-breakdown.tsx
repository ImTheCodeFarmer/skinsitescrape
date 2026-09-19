"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { gameLabel } from "@/lib/casinos";
import { count, money, moneyShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GameStat, ProfitBreakdown } from "@/lib/types";

type RowSpec = { label: string; hint: string; value: number };

/** Pot sites: house net split into the bot's wins and losses and the rake on each game. */
export function ProfitBreakdownCard({ data, color }: { data: ProfitBreakdown; color: string }) {
  const rows: RowSpec[] = [
    { label: "Bot wins", hint: "Amount generated from the site bot winning flips", value: data.botWins },
    { label: "Bot losses", hint: data.houseFlips ? `Paid out when the site bot lost, across ${data.houseFlips.toLocaleString("en-US")} flips it played` : "The site bot did not play in range", value: data.botLosses },
    { label: "Coinflip tax", hint: "5% rake on the whole pot", value: data.flipTax },
    { label: "Jackpot tax", hint: "5% rake on each pot", value: data.jackpotTax },
  ];
  return (
    <BreakdownCard
      title="Profit breakdown"
      badge={data.estimated ? "tax partly estimated" : undefined}
      description="Where the house net in range came from"
      rows={rows}
      total={data.total}
      color={color}
    />
  );
}

/** Other sites: house net per game, from the same rollup the top-games chart reads. */
export function GameNetCard({ games, color }: { games: GameStat[]; color: string }) {
  const rows: RowSpec[] = games.map((g) => ({ label: gameLabel(g.name), hint: `${count(g.plays)} bets · ${moneyShort(g.wagered)} wagered`, value: g.net }));
  return (
    <BreakdownCard
      title="Net by game"
      description="House net in range, per game"
      rows={rows}
      total={games.reduce((a, g) => a + g.net, 0)}
      color={color}
    />
  );
}

function BreakdownCard({ title, badge, description, rows: rowsSpec, total, color }: { title: string; badge?: string; description: string; rows: RowSpec[]; total: number; color: string }) {
  const scale = Math.max(...rowsSpec.map((r) => Math.abs(r.value)), 1);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          {badge ? <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground">{badge}</Badge> : null}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!rowsSpec.length ? <p className="text-sm text-muted-foreground">Nothing settled yet.</p> : null}
        {rowsSpec.map((r) => {
          const share = total > 0 && r.value > 0 ? r.value / total : null;
          return (
            <div key={r.label} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{r.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.hint}</div>
                </div>
                <div className="text-right">
                  <div className={cn("font-mono text-sm tabular-nums", r.value >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {r.value >= 0 ? "+" : "−"}{money(Math.abs(r.value))}
                  </div>
                  {share != null ? <div className="text-[11px] text-muted-foreground">{(share * 100).toFixed(0)}%</div> : null}
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.max(2, (Math.abs(r.value) / scale) * 100)}%`, background: r.value >= 0 ? color : "rgb(251 113 133)" }}
                />
              </div>
            </div>
          );
        })}
        <div className="flex items-baseline justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className={cn("font-mono text-base font-semibold tabular-nums", total >= 0 ? "text-emerald-400" : "text-rose-400")}>
            {total >= 0 ? "+" : "−"}{money(Math.abs(total))}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
