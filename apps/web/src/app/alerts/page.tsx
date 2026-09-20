import { Restricted } from "@/components/restricted";
import { AlertsView } from "@/components/views/alerts";
import { getSession, isAdmin } from "@/lib/auth";
import { getBot, listRules } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Telegram alerts — SkinWagerTracker" };

/** Set up a personal Telegram bot and the alerts it sends. Admin only, like profiles. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession();
  if (!isAdmin(session)) return <Restricted what="Telegram alerts" pitch="Your own Telegram bot pings you the moment a bet you care about settles: a whale on any site, one player you follow, or a big win. Set up in about two minutes." signedIn={Boolean(session)} />;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const [bot, rules] = await Promise.all([getBot(session!.steamId), listRules(session!.steamId)]);
  return <AlertsView bot={bot} rules={rules} prefill={{ site: one(sp.site), playerId: one(sp.player), playerName: one(sp.name) }} />;
}
