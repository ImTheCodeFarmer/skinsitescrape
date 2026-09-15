import { notFound } from "next/navigation";
import { CasinoView } from "@/components/views/casino";
import { CASINOS, getCasinoMeta } from "@/lib/casinos";
import { highlights, parseRange, profitBreakdown, recentCoinflips, recentJackpots, series, statuses, summary, topGames, topPlayers, trackedSites } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export function generateStaticParams() {
  return CASINOS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: Props) {
  const c = getCasinoMeta((await params).slug);
  return { title: c ? `${c.name} — House Edge` : "Not found" };
}

export default async function Page({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const meta = getCasinoMeta(slug);
  if (!meta) notFound();
  const range = parseRange(sp.range);
  const [tracked, st] = await Promise.all([trackedSites(), statuses()]);
  if (!tracked.includes(slug)) {
    return <CasinoView meta={meta} range={range} tracked={false} summary={null} series={[]} players={[]} games={[]} status={null} flips={[]} pots={[]} breakdown={null} records={null} renderedAt={new Date().toISOString()} />;
  }
  const [s, pts, players, games, flips, pots, breakdown, records] = await Promise.all([
    summary(slug, range),
    series(slug, range),
    topPlayers(slug, range, 10),
    topGames(slug, range),
    recentCoinflips(slug, range),
    recentJackpots(slug, range),
    profitBreakdown(slug, range),
    highlights(slug, range),
  ]);
  return (
    <CasinoView meta={meta} range={range} tracked summary={s} series={pts} players={players} games={games} status={st[slug] ?? null} flips={flips} pots={pots} breakdown={breakdown} records={records} renderedAt={new Date().toISOString()} />
  );
}
