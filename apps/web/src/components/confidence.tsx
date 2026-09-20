import { Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LinkEvidence } from "@/lib/types";

/** How sure we are that two accounts are one person, as a label, a bar and the evidence on hover. */
export function confidenceLabel(score: number) {
  if (score >= 0.95) return { label: "Same person", tone: "text-emerald-400", bar: "bg-emerald-400" };
  if (score >= 0.7) return { label: "Very likely", tone: "text-sky-400", bar: "bg-sky-400" };
  if (score >= 0.4) return { label: "Possibly", tone: "text-amber-400", bar: "bg-amber-400" };
  return { label: "Weak match", tone: "text-muted-foreground", bar: "bg-muted-foreground" };
}

export function evidenceLines(e: LinkEvidence, hops: number) {
  const lines: string[] = [];
  if (e.permanent) lines.push(`Permanent link${e.confirmedAt ? `, confirmed ${new Date(e.confirmedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}${e.source === "admin" ? " by an admin" : ""} on the evidence below. Kept by user id from then on, so a new name or picture cannot break it.`);
  if (e.steam) lines.push("Same Steam id on both sites");
  if (e.avatar) lines.push(e.avatarOwners <= 2 ? "Same Steam profile picture" : `Same profile picture, shared by ${e.avatarOwners} accounts`);
  if (e.name) lines.push(e.alias ? "Same name as a past Steam alias" : "Same display name");
  if (e.sharedDays > 0) lines.push(`Active on ${e.sharedDays} of the same days in the last 90`);
  else if (e.daysA >= 5 && e.daysB >= 5) lines.push("Never active on the same day despite regular play on both");
  if (hops > 1) lines.push("Linked through another account; confidence is the weakest link in the chain");
  return lines;
}

export function Confidence({ score, evidence, hops, className }: { score: number; evidence: LinkEvidence; hops: number; className?: string }) {
  const c = confidenceLabel(score);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex cursor-default flex-col gap-1", className)}>
          <span className="flex items-baseline justify-between gap-3 text-xs">
            <span className={cn("inline-flex items-center gap-1 font-medium", c.tone)}>
              {evidence.permanent ? <Lock className="size-3 shrink-0" strokeWidth={2} aria-label="Permanent link" /> : null}
              {c.label}
            </span>
            <span className="text-muted-foreground tabular-nums">{Math.round(score * 100)}%</span>
          </span>
          <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className={cn("block h-full rounded-full", c.bar)} style={{ width: `${Math.round(score * 100)}%` }} />
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex max-w-xs flex-col gap-0.5">
        {evidenceLines(evidence, hops).map((l) => <span key={l}>{l}</span>)}
      </TooltipContent>
    </Tooltip>
  );
}
