"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { SteamSignInLink } from "@/components/steam-button";
import type { Range } from "@/lib/types";

/**
 * Wraps a page rendered with placeholder numbers: the content is blurred and
 * inert, and a card on top asks the visitor to sign in. The real query never
 * ran, so nothing behind the blur is worth peeking at.
 */
export function Locked({ range, children }: { range: Range; children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none select-none blur-[6px] saturate-50" inert>
        {children}
      </div>
      <div className="absolute inset-0 z-10 flex items-start justify-center pt-24 md:pt-40">
        <div className="mx-4 w-full max-w-md rounded-xl border border-border/80 bg-background/95 p-6 shadow-2xl backdrop-blur">
          <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-muted">
            <Lock className="size-5" />
          </div>
          <h2 className="text-lg font-semibold tracking-tight">Sign in to see {range} days of history</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            The 24 hour and 7 day views are open to everyone. Longer ranges need an account. Signing in with Steam is free and only tells us your public Steam id.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <SteamSignInLink />
            <Link href={`${pathname}?range=7`} className="text-sm text-muted-foreground hover:text-foreground">
              Back to 7 days
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
