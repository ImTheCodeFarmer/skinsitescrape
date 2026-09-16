"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { RangeTabs } from "@/components/range-tabs";
import { AutoRefresh } from "@/components/auto-refresh";
import { UserMenu, type SessionView } from "@/components/user-menu";
import { getCasinoMeta } from "@/lib/casinos";
import { cn } from "@/lib/utils";

export function SiteHeader({ anyConnected, session }: { anyConnected: boolean; session: SessionView | null }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const slug = pathname.startsWith("/casino/") ? pathname.split("/")[2] : null;
  const casino = slug ? getCasinoMeta(slug) : undefined;
  const qs = params.get("range") ? `?range=${params.get("range")}` : "";

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="h-5!" />
      <nav className="flex items-center gap-1.5 text-sm">
        <Link href={`/${qs}`} className="text-muted-foreground hover:text-foreground">Overview</Link>
        {casino ? (
          <>
            <ChevronRight className="size-3.5 text-muted-foreground/60" />
            <span className="font-medium">{casino.name}</span>
          </>
        ) : null}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <span className="relative flex size-1.5">
            {anyConnected ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" /> : null}
            <span className={cn("relative inline-flex size-1.5 rounded-full", anyConnected ? "bg-emerald-400" : "bg-rose-400")} />
          </span>
          {anyConnected ? "Live" : "Collector offline"}
        </span>
        <AutoRefresh />
        <RangeTabs />
        <Separator orientation="vertical" className="h-5!" />
        <UserMenu session={session} />
      </div>
    </header>
  );
}
