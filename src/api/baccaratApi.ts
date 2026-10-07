import { type APIRequestContext } from '@playwright/test';
import { currentTarget, type Target } from '../support/target';

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type BetZone = 'player' | 'banker' | 'tie' | 'playerPair' | 'bankerPair';
export type Outcome = 'player' | 'banker' | 'tie';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export interface SettlementLine {
  zone: BetZone;
  wager: number;
  payout: number;
  net: number;
  status: 'won' | 'lost' | 'push';
}

export interface RoundSummary {
  round: number;
  playerCards: Card[];
  bankerCards: Card[];
  playerInitial: number;
  bankerInitial: number;
  playerPoints: number;
  bankerPoints: number;
  natural: boolean;
  outcome: Outcome;
  playerPair: boolean;
  bankerPair: boolean;
  settlement: {
    totalWager: number;
    totalReturn: number;
    netWin: number;
    lines: SettlementLine[];
  };
}

export interface LedgerEntry {
  id: string;
  type: 'INIT' | 'DEBIT' | 'REFUND' | 'PAYOUT';
  description: string;
  beforeCents: number;
  deltaCents: number;
  afterCents: number;
  beforeBalance: number;
  delta: number;
  afterBalance: number;
}

export interface BeadRoadEntry {
  round: number;
  outcome: Outcome;
  playerPoints: number;
  bankerPoints: number;
  natural: boolean;
  playerPair: boolean;
  bankerPair: boolean;
}

export interface SessionState {
  sessionId: string;
  mode: Target;
  balanceCents: number;
  balance: number;
  tableState: 'BETTING_OPEN' | 'BETTING_CLOSED';
  betsCents: Record<BetZone, number>;
  bets: Record<BetZone, number>;
  totalBet: number;
  roundNumber: number;
  lastRound: RoundSummary | null;
  beadRoad: BeadRoadEntry[];
  ledger: LedgerEntry[];
  deduplicated?: boolean;
  transactionId?: string;
  round?: RoundSummary;
}

export interface SimulationReport {
  rounds: number;
  seed: number;
  mode: Target;
  counts: Record<BetZone, number>;
  probabilities: Record<BetZone, number>;
  rtp: Record<BetZone, number>;
  theoretical: {
    probabilities: Record<BetZone, number>;
    rtp: Record<BetZone, number>;
  };
}

export interface ApiErrorResponse {
  status: number;
  ok: boolean;
  error?: string;
  code?: string;
  state?: SessionState;
}

/** Parse shorthand like "S9" -> { suit: 'S', rank: '9' } or "H10" -> { suit: 'H', rank: '10' }. */
export function cards(...codes: string[]): Card[] {
  return codes.map((code) => {
    const suit = code[0] as Suit;
    const rank = code.slice(1) as Rank;
    return { suit, rank };
  });
}

export class BaccaratApi {
  readonly mode: Target;

  constructor(
    private readonly request: APIRequestContext,
    readonly sessionId: string,
    private readonly onStateChange?: () => Promise<void>,
  ) {
    this.mode = currentTarget();
  }

  private headers(): Record<string, string> {
    return {
      'X-Session-Id': this.sessionId,
      'X-Target-Mode': this.mode,
    };
  }

  async getState(): Promise<SessionState> {
    const res = await this.request.get('/api/state', { headers: this.headers() });
    return (await res.json()) as SessionState;
  }

  async reset(balance = 1000): Promise<SessionState> {
    const res = await this.request.post('/api/session/reset', {
      headers: this.headers(),
      data: { balance, mode: this.mode },
    });
    const state = (await res.json()) as SessionState;
    if (this.onStateChange) await this.onStateChange();
    return state;
  }

  async setTableState(state: 'BETTING_OPEN' | 'BETTING_CLOSED'): Promise<SessionState> {
    const res = await this.request.post('/api/table/state', {
      headers: this.headers(),
      data: { state },
    });
    const next = (await res.json()) as SessionState;
    if (this.onStateChange) await this.onStateChange();
    return next;
  }

  async placeBet(zone: BetZone, amount: number, idempotencyKey?: string): Promise<SessionState> {
    const res = await this.request.post('/api/bets', {
      headers: this.headers(),
      data: { zone, amount, idempotencyKey },
    });
    const body = (await res.json()) as SessionState & { error?: string };
    if (!res.ok()) {
      throw new Error(`POST /api/bets failed (${res.status()}): ${body.error ?? 'Unknown error'}`);
    }
    if (this.onStateChange) await this.onStateChange();
    return body;
  }

  async tryPlaceBet(zone: BetZone, amount: number, idempotencyKey?: string): Promise<ApiErrorResponse> {
    const res = await this.request.post('/api/bets', {
      headers: this.headers(),
      data: { zone, amount, idempotencyKey },
    });
    const body = (await res.json()) as SessionState & { error?: string; code?: string };
    if (this.onStateChange) await this.onStateChange();
    if (res.ok()) {
      return { status: res.status(), ok: true, state: body };
    }
    return { status: res.status(), ok: false, error: body.error, code: body.code };
  }

  async deal(deck?: Card[]): Promise<SessionState & { round: RoundSummary }> {
    const res = await this.request.post('/api/deal', {
      headers: this.headers(),
      data: deck ? { deck } : {},
    });
    const state = (await res.json()) as SessionState & { round: RoundSummary };
    if (this.onStateChange) await this.onStateChange();
    return state;
  }

  async simulate(rounds = 100_000, seed = 20261007): Promise<SimulationReport> {
    const res = await this.request.post('/api/simulate', {
      headers: this.headers(),
      data: { rounds, seed, mode: this.mode },
    });
    return (await res.json()) as SimulationReport;
  }
}
