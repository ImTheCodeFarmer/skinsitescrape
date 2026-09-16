"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { gameLabel } from "@/lib/casinos";
import { dateTime, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BetRow } from "@/lib/types";

const MotionRow = motion.create(TableRow);
const rowAnim = {
  initial: { opacity: 0, y: -10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { type: "spring" as const, stiffness: 260, damping: 26 },
};

function Who({ name, avatar, color }: { name: string; avatar: string | null; color: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {avatar?.startsWith("http") ? (
        <Image src={avatar} alt="" width={22} height={22} unoptimized className="size-[22px] shrink-0 rounded-full object-cover" />
      ) : (
        <span className="grid size-[22px] shrink-0 place-items-center rounded-full text-[9px] font-semibold" style={{ background: `${color}22`, color }}>
          {name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?"}
        </span>
      )}
      <span className="max-w-[10rem] truncate">{name}</span>
    </span>
  );
}

/** Settled bets by real players, newest first. Net is the player's side: positive when they came out ahead. */
export function BetsTable({ bets, color }: { bets: BetRow[]; color: string }) {
  if (!bets.length) return <p className="px-4 py-8 text-center text-sm text-muted-foreground">No bets settled in this range yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Settled</TableHead>
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
            return (
              <MotionRow key={b.id} layout {...rowAnim}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateTime(b.settledAt)}</TableCell>
                <TableCell><Who name={b.player.name} avatar={b.player.avatar} color={color} /></TableCell>
                <TableCell><Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">{gameLabel(b.game)}</Badge></TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(b.wagered)}</TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell">{money(b.payout)}</TableCell>
                <TableCell className="text-right">
                  <span className={cn("font-mono tabular-nums", net >= 0 ? "text-emerald-400" : "text-rose-400")}>{net >= 0 ? "+" : "−"}{money(Math.abs(net))}</span>
                </TableCell>
              </MotionRow>
            );
          })}
        </AnimatePresence>
      </TableBody>
    </Table>
  );
}
