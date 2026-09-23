"use client";

import { AnimatePresence, motion } from "motion/react";
import { Flame } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PlayerLink } from "@/components/player-link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PlayerStat } from "@/lib/types";
import { count, money } from "@/lib/format";
import { cn } from "@/lib/utils";

const MotionRow = motion.create(TableRow);
const rowAnim = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8, transition: { duration: 0.15, ease: "easeOut" as const } },
  transition: { type: "spring" as const, stiffness: 260, damping: 26 },
};


export function TopPlayersTable({ players, color, site, limit = 10, rangeDays }: { players: PlayerStat[]; color: string; site: string; limit?: number; rangeDays?: number }) {
  if (!players.length) return <p className="px-4 py-8 text-center text-sm text-muted-foreground">No settled bets in this range yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-10">#</TableHead>
          <TableHead>Player</TableHead>
          <TableHead className="text-right">Wagered</TableHead>
          <TableHead className="text-right">Net</TableHead>
          <TableHead className="hidden text-right md:table-cell">Bets</TableHead>
          <TableHead className="hidden lg:table-cell">Favorite</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <AnimatePresence initial={false}>
        {players.slice(0, limit).map((p, i) => (
          <MotionRow key={p.id} layout {...rowAnim}>
            <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
            <TableCell>
              <PlayerLink site={site} id={p.id} name={p.handle} avatar={p.avatar} streamer={p.streamer} color={color} size={28} className="gap-2.5" nameClassName="max-w-[14rem] font-medium">
                {p.activeDays >= 5 ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="h-4 cursor-default gap-1 border-orange-500/30 px-1.5 py-0 text-[10px] leading-none text-orange-400">
                        <Flame className="size-2.5 shrink-0" strokeWidth={1.5} />
                        <span className="leading-none">{p.activeDays}d</span>
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Placed bets on {p.activeDays} {rangeDays ? `of the last ${rangeDays} ` : ""}days
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </PlayerLink>
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">{money(p.wagered)}</TableCell>
            <TableCell className={cn("text-right font-mono tabular-nums", p.net >= 0 ? "text-emerald-400" : "text-rose-400")}>
              {p.net >= 0 ? "+" : "−"}{money(Math.abs(p.net))}
            </TableCell>
            <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">{count(p.bets)}</TableCell>
            <TableCell className="hidden text-muted-foreground lg:table-cell">{p.favorite}</TableCell>
          </MotionRow>
        ))}
        </AnimatePresence>
      </TableBody>
    </Table>
  );
}
