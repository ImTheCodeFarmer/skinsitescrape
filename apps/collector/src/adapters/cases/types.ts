/**
 * Shapes on wss://ws.cases.gg/ (battles, item coinflip) and
 * wss://cgs.cases.gg/ (crash). Both are plain websockets whose frames are
 * `[event, data]`. Captured 2026-09-16; the item-coinflip shapes come from
 * the site's client code because no game ran while we listened. Money is
 * integer cents of USD, the same unit the legacy dashboard used for the site.
 */

export type CgCurrency = "REAL" | "PLAY" | string;

export type CgUser = {
  id: number;
  name?: string;
  /** Absolute URL, or a site-relative path such as /assets/common/avatar-anonymous.png. */
  avatar?: string | null;
  role?: string;
  xp?: number;
  level?: number;
};

// ---------------------------------------------------------------- battles

/** One seat. Bots have `botId` and no user; `borrowMultiplier` > 1 is a loan (see site.ts). */
export type CgBattlePlayer = {
  id: number;
  team: number;
  botId: number | null;
  borrowMultiplier?: number;
  user: CgUser | null;
  currency: CgCurrency | null;
  doubleDown?: unknown;
};

/** `battles:new`, and GET /api/battles/:id/details. */
export type CgBattle = {
  id: number;
  battleId?: number;
  mode: "normal" | "crazy" | "crazy-jackpot" | "group" | "terminal" | "crazy-terminal" | "jackpot" | string;
  currency: CgCurrency;
  createdAt: string;
  state: "open" | "in-progress" | "finished" | string;
  playerCount: number;
  teamSize: number;
  /** Cents a seat costs, after any creator-funded discount. */
  joinPrice: number;
  prediscountPrice?: number | null;
  cases: { slug: string; amount: number }[];
  createdById: number;
  isPrivate: boolean;
  isSuperSpin?: boolean;
  isFastSpin?: boolean;
  isJackpot?: boolean;
  isBonusBattle?: boolean;
  players: CgBattlePlayer[];
  winningTeam?: number | null;
};

export type CgBattleJoin = CgBattlePlayer & { battleId: number };

export type CgBattleDrop = {
  id: number;
  battlePlayerId: number;
  team: number;
  userId: number | null;
  botId: number | null;
  hitSuperSpin?: boolean;
  item: { name: string; price: number; productId?: number };
  caseSlug?: string;
};

/** `battles:round`: one drop per seat for one case. */
export type CgBattleRound = { battleId: number; roundNo?: number; drops: CgBattleDrop[] };

export type CgBattleStart = { battleId: number; startsAt: string; serverTime: string; seed: string; proof?: unknown };

export type CgBattleFinished = { battleId: number; winningTeam: number; isCoinflip: boolean; isJackpot: boolean };

// ---------------------------------------------------------------- item coinflip

export type CgCoinflipSide = "LOW" | "HIGH";

export type CgCoinflipPlayer = { id: number; botId?: number | null; user?: CgUser | null };

export type CgCoinflipItem = { playerId: number; price: number; item?: { id?: number; name?: string } };

/** `item-coinflip:new` and `item-coinflip:update` (the whole game each time). */
export type CgCoinflip = {
  id: number;
  status: "OPEN" | "IN_PROGRESS" | "AWAITING_EOS" | "FINISHED" | string;
  betAmount: number;
  createdById: number;
  creatorSide: CgCoinflipSide;
  players: CgCoinflipPlayer[];
  items?: CgCoinflipItem[];
  /** `players[].id` of the winner. */
  winnerId?: number | null;
  ticket?: number | null;
  proof?: unknown;
  currency?: CgCurrency;
  createdAt?: string;
  updatedAt?: string;
};

export type CgCoinflipAwaiting = { itemCoinflipId: number; proof: unknown };

// ---------------------------------------------------------------- crash

export type CgCrashBet = {
  betId: number;
  amount: number;
  roundedAmount?: number;
  currency: CgCurrency;
  user: CgUser;
  state: "pending" | "active" | "cashout" | "lost" | string;
  cashedOutAt?: number;
  winnings?: number;
};

/** Sent on every state change with the full bet list. `at` is the crash point once ended. */
export type CgCrashStatus = {
  gameId: number;
  state: "betting" | "blocked" | "in-progress" | "ended" | "paused" | string;
  bets: CgCrashBet[];
  startedAt: number;
  now: number;
  at?: number;
};

export type CgCrashCashout = { betId: number; user?: CgUser; at: number; winnings: number; currency?: CgCurrency; productsWon?: unknown[] };

/** ~7 a second while a round flies. */
export type CgCrashTick = { elapsed: number; at: number; cashouts: CgCrashCashout[] };

export type CgCrashHistoryEntry = { id: number; crashedAt: number; seed: string };
