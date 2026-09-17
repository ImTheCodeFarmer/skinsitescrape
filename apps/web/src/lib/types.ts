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
  /** What winning players took home net of their stakes. */
  playerWins: number;
  /** Stakes lost on losing bets. playerLosses − playerWins = net. */
  playerLosses: number;
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

/** One tracked game of a site, from the daily rollup. */
export type SiteGameInfo = { game: string; label: string; bets: number; firstDay: string; lastDay: string };

export type SiteStatus = {
  site: string;
  connected: boolean;
  lastEventAt: string | null;
  lastConnectAt: string | null;
  reconnects: number;
};

export type Conversion = {
  /** What the site calls its balance: "USD", "gem", "coin", "scrap". */
  unit: string;
  /** USD value of one unit. */
  usdPerUnit: number;
  /** How amounts arrive on the feed, e.g. "cents of a gem". */
  wire: string;
  /** Where the rate comes from. */
  source: string;
  /** The collector re-reads the rate from the site's feed; `usdPerUnit` is then the fallback. */
  live?: boolean;
  /** No published rate was found; the figure is a guess. */
  assumed?: boolean;
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
  /** How the site's amounts become the USD figures stored in `bets`. Shown on the admin site info tab only. */
  conversion: Conversion;
  /** Short note on modes the site offers but the collector cannot see. */
  untracked?: string;
  /** Site runs pot games (coinflip / jackpot) with their own detail tables, breakdown and records. */
  pots?: boolean;
  /** Per `bets.game` key, a page for one round with `{id}` in place of the round id. Games without one are not linked. */
  roundUrls?: Record<string, string>;
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

/** Where the house's net came from over the range. Components sum to `total`. */
export type ProfitBreakdown = {
  /** Stakes the house bot took from players on flips it won. */
  botWins: number;
  /** Stakes the house bot lost to players on flips it lost (negative or zero). */
  botLosses: number;
  flipTax: number;
  jackpotTax: number;
  total: number;
  houseFlips: number;
  /** Some rounds in range carry an estimated tax rather than one reported by the site. */
  estimated: boolean;
};

export type HighlightPlayer = { name: string; avatar: string | null; house: boolean };

export type Highlight = {
  amount: number;
  /** How to render `amount`. Default money. */
  format?: "money" | "count";
  at: string; // ISO
  /** A `bets.game` key, or "hourly" for the busiest-hour tile. */
  game: string;
  roundId: string;
  /** Short line under the amount, e.g. "Lyon beat JIMMY". */
  caption: string;
  players: HighlightPlayer[];
};

export type Highlights = {
  biggestFlip: Highlight | null;
  biggestPlayerWin: Highlight | null;
  /** Pot sites: largest gross the house took from one round. Others: the biggest stake a player lost. */
  biggestSiteWin: Highlight | null;
  biggestJackpot: Highlight | null;
  /** Jackpot won at the lowest chance. */
  longestShot: Highlight | null;
  /** Most consecutive coinflip wins by one player. */
  longestStreak: Highlight | null;
  /** Largest payout to a player who beat the house bot. */
  biggestBotLoss: Highlight | null;
  /** Hour with the most wagered. */
  peakHour: Highlight | null;
};

/** One settled bet by a real player, for the recent-bets table on sites without pot games. */
export type BetRow = {
  id: string;
  game: string;
  roundId: string | null;
  placedAt: string;
  settledAt: string;
  player: { id: string; name: string; avatar: string | null };
  wagered: number;
  payout: number;
  won: boolean | null;
};

/** One live tick for a casino page: the moving buckets, the small aggregates, and rounds newer than the client's cursor. */
export type LiveCasino = {
  at: string;
  summary: Summary;
  tail: Point[];
  games: GameStat[];
  players: PlayerStat[];
  /** null on sites without pot games */
  breakdown: ProfitBreakdown | null;
  records: Highlights;
  flips: CoinflipRound[];
  pots: JackpotRound[];
  bets: BetRow[];
};

/** One live tick for the overview. */
export type LiveOverview = {
  at: string;
  sites: SiteCard[];
  totals: Summary;
  aggTail: Point[];
  siteTails: Record<string, Point[]>;
  games: GameStat[];
  players: (PlayerStat & { site: string })[];
};
