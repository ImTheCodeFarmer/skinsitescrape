"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/** Steam's logo, for the sign-in button. */
export function SteamIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M11.98 0A12 12 0 0 0 .02 11.08l6.44 2.66a3.38 3.38 0 0 1 1.9-.59h.19l2.86-4.15v-.06a4.51 4.51 0 1 1 4.51 4.52h-.1l-4.09 2.92v.15a3.39 3.39 0 0 1-6.72.66L.35 15.3A12 12 0 1 0 11.98 0Zm-4.4 18.2-1.47-.61a2.54 2.54 0 0 0 4.7-.28 2.55 2.55 0 0 0-1.4-3.34 2.6 2.6 0 0 0-1.95 0l1.52.63a1.87 1.87 0 1 1-1.4 3.6Zm8.32-6.24a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm-2.26-3a2.26 2.26 0 1 0 4.51 0 2.26 2.26 0 0 0-4.51 0Z" />
    </svg>
  );
}

/** Link to the Steam sign-in route, returning to the page the user is on. */
export function SteamSignInLink({ className, children, next }: { className?: string; children?: React.ReactNode; next?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const qs = params.toString();
  const dest = next ?? `${pathname}${qs ? `?${qs}` : ""}`;
  return (
    <a
      href={`/api/auth/steam?next=${encodeURIComponent(dest)}`}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-md bg-[#171a21] px-3.5 text-sm font-medium text-white ring-1 ring-white/10 transition-colors hover:bg-[#1b2838]",
        className,
      )}
    >
      <SteamIcon className="size-4" />
      {children ?? "Sign in through Steam"}
    </a>
  );
}
