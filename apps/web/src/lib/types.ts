/** Serializable shapes shared by server queries and client components. */
export type Range = 1 | 7 | 30 | 90; // 1 = last 24h (hourly buckets)

export type Point = {
  /** ISO timestamp of the bucket start. */
  t: string;
  wagered: number;
  net: number; // house net for the bucket, negative = house lost
  players: number;
  bets: number;
};

export type Summary = {
  wagered: number;
  payout: number;
  profit: number; // sum of positive-net buckets
  loss: number; // sum of |negative-net| buckets
  net: number;
  players: number; // distinct players in range
  bets: number;
  rtp: number; // percent
  deltaWager: number | null; // vs previous window, fraction; null when no prior data
  deltaNet: number | null;
};

export type GameStat = { name: string; wagered: number; plays: number; net: number };

export type PlayerStat = {
  id: string;
  handle: string;
  avatar: string | null;
  wagered: number;
  net: number; // player P/L, negative = lost to the house
  bets: number;
  favorite: string;
  activeDays: number;
};

export type SiteStatus = {
  site: string;
  connected: boolean;
  lastEventAt: string | null;
  lastConnectAt: string | null;
  reconnects: number;
};

export type CasinoMeta = {
  slug: string;
  name: string;
  url: string;
  logo: string;
  color: string;
  tagline: string;
  founded: number;
  currency: "USD" | "Coins";
};

export type SiteCard = {
  meta: CasinoMeta;
  tracked: boolean;
  summary: Summary | null;
  spark: number[];
  status: SiteStatus | null;
};

export type CoinflipRound = {
  id: string;
  createdAt: string;
  settledAt: string | null;
  status: string;
  creator: { id: string; name: string; avatar: string | null; house: boolean; total: number; pick: number | null };
  opponent: { id: string; name: string; avatar: string | null; house: boolean; total: number } | null;
  winnerId: string | null;
  winningSide: number | null;
  pot: number;
  tax: number | null;
  houseNet: number | null;
};

export type JackpotRound = {
  id: string;
  createdAt: string;
  settledAt: string | null;
  pot: number;
  entries: number;
  winner: { id: string; name: string; avatar: string | null } | null;
  winnerChance: number | null;
  ticket: number | null;
  tax: number | null;
  houseNet: number | null;
  partial: boolean;
};
