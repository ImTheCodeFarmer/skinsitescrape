"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Re-fetches the server components on an interval while the tab is visible.
 * Client state (open tabs, scroll) survives because nothing remounts; new
 * props flow into the already-mounted views, which animate the deltas.
 */
export function AutoRefresh({ intervalMs = 8_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(0);

  const refresh = React.useCallback(() => {
    if (document.visibilityState !== "visible") return;
    setBusy(true);
    React.startTransition(() => {
      router.refresh();
      // router.refresh() gives no promise; assume the RSC round-trip is short.
      setTimeout(() => {
        setBusy(false);
        setUpdatedAt(Date.now());
      }, 600);
    });
  }, [router]);

  React.useEffect(() => {
    const id = setInterval(refresh, intervalMs);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(id);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, intervalMs]);

  const ago = updatedAt && now ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  return (
    <button
      type="button"
      onClick={refresh}
      title="Refreshes automatically while this tab is visible"
      className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
    >
      <RefreshCw className={cn("size-3", busy && "animate-spin")} />
      {ago == null ? "auto-refresh" : ago < 2 ? "updated just now" : `updated ${ago}s ago`}
    </button>
  );
}
