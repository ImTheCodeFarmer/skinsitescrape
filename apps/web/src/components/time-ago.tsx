"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "always" });
const exactFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
});

/** "just now", "5 minutes ago", "8 hours ago", "3 days ago". Never shorter than "just now". */
export function relativeTime(iso: string, now = Date.now()) {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const s = Math.round(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return rtf.format(-m, "minute");
  const h = Math.round(m / 60);
  if (h < 24) return rtf.format(-h, "hour");
  const d = Math.round(h / 24);
  if (d < 30) return rtf.format(-d, "day");
  const mo = Math.round(d / 30);
  if (mo < 12) return rtf.format(-mo, "month");
  return rtf.format(-Math.round(mo / 12), "year");
}

export const exactTime = (iso: string) => exactFmt.format(new Date(iso));

/** One shared clock so every TimeAgo on a page re-renders together, not on its own interval. */
function useNow(intervalMs: number) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * A timestamp shown as "37 minutes ago", with the exact date on hover.
 * The server renders with its own clock, so the first client paint may differ by a few seconds.
 */
export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const now = useNow(30_000);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={iso} suppressHydrationWarning className={cn("cursor-default whitespace-nowrap", className)}>
          {relativeTime(iso, now)}
        </time>
      </TooltipTrigger>
      <TooltipContent side="top" className="tabular-nums">{exactTime(iso)}</TooltipContent>
    </Tooltip>
  );
}
