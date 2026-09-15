import { NextResponse, type NextRequest } from "next/server";
import { getCasinoMeta } from "@/lib/casinos";
import { liveCasino, liveOverview } from "@/lib/live";
import { parseRange, trackedSites } from "@/lib/queries";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/live?site=<slug|all>&range=<1|7|30|90>&since=<ISO>
 * Polled by the pages every few seconds. `since` is the newest round the
 * client already has, so only newer rounds come back.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const site = q.get("site") ?? "all";
  const range = parseRange(q.get("range") ?? undefined);
  const sinceRaw = q.get("since");
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : new Date().toISOString();

  if (site === "all") return NextResponse.json(await liveOverview(range), { headers: NO_STORE });
  if (!getCasinoMeta(site)) return NextResponse.json({ error: "unknown site" }, { status: 404, headers: NO_STORE });
  if (!(await trackedSites()).includes(site)) return NextResponse.json({ error: "site not tracked" }, { status: 404, headers: NO_STORE });
  return NextResponse.json(await liveCasino(site, range, since), { headers: NO_STORE });
}
