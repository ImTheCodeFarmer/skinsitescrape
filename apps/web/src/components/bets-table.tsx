"use client";

import { ExternalLink } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { CasinoLogo } from "@/components/casino-logo";
import { PlayerLink } from "@/components/player-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { gameLabel, getCasinoMeta, roundUrl } from "@/lib/casinos";
import { moneyExact } from "@/lib/format";
import { TimeAgo } from "@/components/time-ago";
import { cn } from "@/lib/utils";
import type { BetRow, CasinoMeta } from "@/lib/types";

const MotionRow = motion.create(TableRow);
const rowAnim = {
  initial: { opacity: 0, y: -10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: 0.15, ease: "easeOut" as const } },
  transition: { type: "spring" as const, stiffness: 260, damping: 26 },
};

/** Settled bets by real players, newest first. Net is the player's side: positive when they came out ahead. */
/** `showSite` adds a site column for lists that mix sites (a player's profile); rows then carry their own `site`. */
export function BetsTable({ bets, color, meta, showSite = false }: { bets: (BetRow & { site?: string })[]; color: string; meta?: CasinoMeta; showSite?: boolean }) {
  if (!bets.length) return <p className="px-4 py-8 text-center text-sm text-muted-foreground">No bets settled in this range yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Settled</TableHead>
          {showSite ? <TableHead>Site</TableHead> : null}
          <TableHead>Player</TableHead>
          <TableHead>Game</TableHead>
          <TableHead className="text-right">Wagered</TableHead>
          <TableHead className="hidden text-right md:table-cell">Payout</TableHead>
          <TableHead className="text-right">Player net</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <AnimatePresence initial={false}>
          {bets.map((b) => {
            const net = b.payout - b.wagered;
            const site = b.site ?? meta?.slug;
            const rowMeta = b.site ? getCasinoMeta(b.site) : meta;
            return (
              <MotionRow key={b.id} layout {...rowAnim}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground"><TimeAgo iso={b.settledAt} /></TableCell>
                {showSite ? (
                  <TableCell className="text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">{rowMeta ? <CasinoLogo casino={rowMeta} size={16} className="rounded-sm" /> : null}{rowMeta?.name ?? site}</span>
                  </TableCell>
                ) : null}
                <TableCell><PlayerLink site={site ?? ""} id={b.player.id} name={b.player.name} avatar={b.player.avatar} admin={b.player.admin} color={rowMeta?.color ?? color} nameClassName="max-w-[5.5rem] sm:max-w-[10rem]" /></TableCell>
                <TableCell>
                  {(() => {
                    const href = roundUrl(rowMeta, b.game, b.roundId);
                    const badge = <Badge variant="outline" className="whitespace-nowrap px-1.5 py-0 text-[10px] font-normal">{gameLabel(b.game)}{href ? <ExternalLink className="ml-1 size-2.5" strokeWidth={1.5} /> : null}</Badge>;
                    return href ? <a href={href} target="_blank" rel="noreferrer" title="Open on the site" className="hover:opacity-80">{badge}</a> : badge;
                  })()}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{moneyExact(b.wagered)}</TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell">{moneyExact(b.payout)}</TableCell>
                <TableCell className="text-right">
                  <span className={cn("font-mono tabular-nums", net >= 0 ? "text-emerald-400" : "text-rose-400")}>{net >= 0 ? "+" : "−"}{moneyExact(Math.abs(net))}</span>
                </TableCell>
              </MotionRow>
            );
          })}
        </AnimatePresence>
      </TableBody>
    </Table>
  );
}
