import { notFound } from "next/navigation";
import { PlayerView } from "@/components/views/player";
import { Restricted } from "@/components/restricted";
import { getSession, isAdmin } from "@/lib/auth";
import { getCasinoMeta } from "@/lib/casinos";
import { parseRange, playerProfile } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Player profile — SkinWagerTracker" };

type Props = { params: Promise<{ site: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * One account and every account we link to it, across sites. Admin only:
 * anyone else gets the access notice, and no profile data is queried or
 * rendered for them, not even a blurred placeholder.
 */
export default async function Page({ params, searchParams }: Props) {
  const session = await getSession();
  if (!isAdmin(session)) return <Restricted what="Player profiles" signedIn={Boolean(session)} />;

  const [{ site, id }, sp] = await Promise.all([params, searchParams]);
  if (!getCasinoMeta(site)) notFound();
  const profile = await playerProfile(site, decodeURIComponent(id), parseRange(sp.range));
  if (!profile) notFound();
  return <PlayerView {...profile} />;
}
