"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const OPTIONS: [string, string][] = [["1", "24h"], ["7", "7d"], ["30", "30d"], ["90", "90d"]];

export function RangeTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = OPTIONS.some(([v]) => v === params.get("range")) ? params.get("range")! : "30";
  return (
    <Tabs
      value={current}
      onValueChange={(v) => {
        const next = new URLSearchParams(params.toString());
        next.set("range", v);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }}
    >
      <TabsList className="h-8">
        {OPTIONS.map(([v, label]) => (
          <TabsTrigger key={v} value={v} className="px-2.5 text-xs">{label}</TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
