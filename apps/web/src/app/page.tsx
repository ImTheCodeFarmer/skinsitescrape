import { OverviewView } from "@/components/views/overview";
import { parseRange, series, siteCards, summary, topGames, topPlayers } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const range = parseRange((await searchParams).range);
  const sites = await siteCards(range);
  const tracked = sites.filter((s) => s.tracked).map((s) => s.meta.slug);
  const [totals, agg, games, players, ...perSite] = await Promise.all([
    summary(null, range),
    series(null, range),
    topGames(null, range),
    topPlayers(null, range, 8),
    ...tracked.map((slug) => series(slug, range)),
  ]);
  return (
    <OverviewView
      range={range}
      sites={sites}
      totals={totals}
      agg={agg}
      series={Object.fromEntries(tracked.map((slug, i) => [slug, perSite[i]]))}
      games={games}
      players={players}
    />
  );
}
