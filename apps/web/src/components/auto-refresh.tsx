"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { useLiveStatus } from "@/lib/live-client";
import { cn } from "@/lib/utils";

/**
 * Shows the live polling state. The pages poll /api/live themselves (see
 * lib/live-client); this only reports the last successful tick and offers a
 * manual refresh.
 */
export function AutoRefresh() {
  const { fetching, updatedAt, refresh } = useLiveStatus();
  const [now, setNow] = React.useState(0);
  React.useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);
  const ago = updatedAt && now ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  return (
    <button
      type="button"
      onClick={() => void refresh()}
      title="Updates every few seconds while this tab is visible"
      aria-busy={fetching}
      className="hidden items-center gap-1.5 rounded-md py-1 ps-1.5 pe-2 text-[11px] text-muted-foreground transition-[color,background-color,scale] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.96] sm:inline-flex"
    >
      <RefreshCw className={cn("size-3", fetching && "animate-spin")} strokeWidth={1.5} />
      {fetching ? "updating…" : ago == null ? "live" : ago < 2 ? "updated just now" : `updated ${ago}s ago`}
    </button>
  );
}
