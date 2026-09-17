"use client";

import { usePathname, useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ADMIN_TABS, type AdminTab } from "@/lib/admin-tabs";

export function AdminTabs({ current }: { current: AdminTab }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Tabs value={current} onValueChange={(v) => router.replace(v === "users" ? pathname : `${pathname}?tab=${v}`, { scroll: false })}>
      <TabsList className="h-8">
        {ADMIN_TABS.map(([v, label]) => (
          <TabsTrigger key={v} value={v} className="px-2.5 text-xs">{label}</TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
