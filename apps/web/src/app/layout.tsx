import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { ResumeRefresh } from "@/components/resume-refresh";
import { ViewerProvider } from "@/components/viewer";
import { getSession, isAdmin } from "@/lib/auth";
import { LiveProvider } from "@/lib/live-client";
import { siteCards } from "@/lib/queries";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SkinWagerTracker — skin casino stats",
  description: "Wager, profit, loss, top players and top games across skin casinos.",
};
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Sidebar always shows the last 7 days, independent of the page's range.
  const [sites, session] = await Promise.all([siteCards(7), getSession()]);
  const anyConnected = sites.some((s) => s.status?.connected);
  const admin = isAdmin(session);
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}>
      <body className="min-h-full">
        <LiveProvider>
        <ViewerProvider admin={admin}>
        <ResumeRefresh />
        <TooltipProvider>
          <SidebarProvider>
            <Suspense>
              <AppSidebar sites={sites} admin={admin} />
            </Suspense>
            <SidebarInset className="min-w-0">
              <Suspense>
                <SiteHeader anyConnected={anyConnected} session={session ? { steamId: session.steamId, name: session.name, avatar: session.avatar } : null} />
              </Suspense>
              <div className="flex-1 p-4 md:p-6">{children}</div>
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
        </ViewerProvider>
        </LiveProvider>
      </body>
    </html>
  );
}
