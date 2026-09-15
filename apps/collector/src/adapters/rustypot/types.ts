/** Shapes observed on wss://rustypot.com/socket.io (EIO=4), captured 2026-09-15. */

export type RpItem = { name: string; image: string; price: number };

export type RpSide = {
  displayName: string;
  image: string;
  /** Steam64 id, or "JIMMY" for the house bot. */
  id: string;
  /** 0 | 1, the coin side the creator picked. Only on creator. */
  pick?: number;
  /** USD total of deposited items. */
  total?: number;
  depositedItems?: RpItem[];
  offerID?: string;
};

export type RpWinner = {
  /** Winning coin side, 0 | 1. */
  coin: number;
  id: string;
  image: string;
  displayName: string;
  /** Percent as a string, e.g. "48.38". */
  chance: string;
  /** Pot total (creator + opponent) as a string, pre-tax. */
  total: string;
  gameid: string;
};

/** Lifecycle: Open -> Joining -> Flipping -> Ended. "cf RemoveLobby" carries the id of a removed/cancelled lobby. */
export type RpCoinflip = {
  _id: string;
  createDate: string;
  hash: { hash: string; serverSeed?: string; serialNumber?: number; signedSeed?: string; ticket?: number; internalId?: string };
  status: "Open" | "Joining" | "Flipping" | "Ended" | string;
  creator: RpSide;
  /** `{}` while Open. */
  opponent?: Partial<RpSide>;
  timer?: number;
  doubleDownCount?: number;
  /** Trade-bot Steam64 id holding the items (not the house player). */
  bot?: string;
  winner?: RpWinner;
  completedDate?: string;
};

/** "jackpot deposit" (single) and "return jackpot deposit" (array, current round). No round id on these. */
export type RpJackpotDeposit = {
  id: string;
  displayName: string;
  image: string;
  userDepositTotal: number;
  depositedItems: RpItem[];
};

/** "jackpot winnerInfo": first message that names the round. */
export type RpJackpotWinnerInfo = { _id: string; image: string; name: string; chance: number; total: number };

/** "ensure jackpot reset" and each row of "return jackpotGameHistory". */
export type RpJackpotResult = {
  id: string;
  winnerDisplayName: string;
  winnerImage: string;
  potTotal: number;
  winnerChance: string;
  ticket: number;
};
