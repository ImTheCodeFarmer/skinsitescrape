"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { Flame } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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

function initials(h: string) {
  return h.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
}

export function TopPlayersTable({ players, color, limit = 10, rangeDays }: { players: PlayerStat[]; color: string; limit?: number; rangeDays?: number }) {
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
              <span className="flex items-center gap-2.5">
                {p.avatar?.startsWith("http") ? (
                  <Image src={p.avatar} alt="" width={28} height={28} unoptimized className="size-7 rounded-full object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10" />
                ) : (
                  <span className="grid size-7 place-items-center rounded-full text-[10px] font-semibold" style={{ background: `${color}22`, color }}>{initials(p.handle)}</span>
                )}
                <span className="max-w-[14rem] truncate font-medium">{p.handle}</span>
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
              </span>
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
