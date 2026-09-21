"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

const HIDDEN_FOR_MS = 60_000;
const EVERY_MS = 5 * 60_000;

/**
 * Keeps a long-lived tab honest. Polling only covers the page's moving
 * parts and pauses while the tab is hidden, so the server-rendered pieces
 * (sidebar, header, anything outside the live tick) drift. Coming back
 * after a minute or more away, or every five minutes while visible,
 * re-renders the server components in place; the live hooks then reset to
 * the fresh render. Nothing is stored, so there is nothing to go stale.
 */
export function ResumeRefresh() {
  const router = useRouter();
  React.useEffect(() => {
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt >= HIDDEN_FOR_MS) {
        hiddenAt = null;
        router.refresh();
      } else {
        hiddenAt = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, [router]);
  return null;
}
