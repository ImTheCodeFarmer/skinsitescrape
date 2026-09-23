"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { Bell, LayoutGrid, Mail, ShieldCheck, Tag } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { CasinoLogo } from "@/components/casino-logo";
import { Sparkline } from "@/components/sparkline";
import { moneyShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SiteCard } from "@/lib/types";

export function AppSidebar({ sites, admin = false }: { sites: SiteCard[]; admin?: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const qs = params.get("range") ? `?range=${params.get("range")}` : "";
  const { setOpenMobile } = useSidebar();

  // Close the mobile drawer after navigating from one of its links.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  return (
    <Sidebar collapsible="offcanvas" className="border-r border-sidebar-border">
      <SidebarHeader className="px-4 pt-4 pb-2">
        <Link href={`/${qs}`} className="flex items-center">
          <div className="leading-tight">
            <div className="text-sm font-semibold">SkinWagerTracker</div>
            <div className="text-[11px] text-muted-foreground">skin casino tracker</div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/"}>
                  <Link href={`/${qs}`}>
                    <LayoutGrid className="size-4" strokeWidth={1.5} />
                    <span>Overview</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/pricing"}>
                  <Link href="/pricing">
                    <Tag className="size-4" strokeWidth={1.5} />
                    <span>Pricing</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/alerts"}>
                  <Link href="/alerts">
                    <Bell className="size-4" strokeWidth={1.5} />
                    <span>Alerts</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/contact"}>
                  <Link href="/contact">
                    <Mail className="size-4" strokeWidth={1.5} />
                    <span>Contact</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {admin ? (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/admin"}>
                    <Link href="/admin">
                      <ShieldCheck className="size-4" strokeWidth={1.5} />
                      <span>Admin</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Sites</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {sites.map(({ meta: c, tracked, summary: s, spark, status }) => {
                const href = `/casino/${c.slug}${qs}`;
                const active = pathname === `/casino/${c.slug}`;
                return (
                  <SidebarMenuItem key={c.slug} className="relative">
                    {active ? (
                      <motion.span layoutId="sidebar-active" className="absolute inset-0 rounded-md bg-sidebar-accent" transition={{ type: "spring", stiffness: 380, damping: 32 }} />
                    ) : null}
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      className={cn("relative h-auto flex-col items-stretch gap-1.5 bg-transparent px-2.5 py-2 transition-[background-color] duration-150 ease-out data-[active=true]:bg-transparent hover:bg-sidebar-accent/60", !tracked && "opacity-55")}
                    >
                      <Link href={href}>
                        <span className="flex items-center gap-2.5">
                          <CasinoLogo casino={c} size={26} />
                          <span className="flex min-w-0 flex-1 flex-col leading-tight">
                            <span className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                              {c.name}
                              {status ? (
                                <span className={cn("size-1.5 rounded-full", status.connected ? "bg-emerald-400" : "bg-rose-400")} title={status.connected ? "collector connected" : "collector offline"} />
                              ) : null}
                            </span>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {tracked && s ? `${moneyShort(s.wagered)} wagered` : "not tracked yet"}
                            </span>
                          </span>
                        </span>
                        {tracked ? (
                          <span className="pl-9 pr-1 opacity-80">
                            <Sparkline data={spark} color={c.color} height={22} />
                          </span>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="flex flex-col gap-1 px-4 py-3">
        <p className="text-[11px] text-muted-foreground">Live data · 14-day sparklines</p>
        <p className="text-[11px] text-muted-foreground">Made with love from Hawaii and Spain</p>
      </SidebarFooter>
    </Sidebar>
  );
}
