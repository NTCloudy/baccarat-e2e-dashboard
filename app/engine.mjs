/**
 * Standard 8-deck Punto Banco (Baccarat) rules engine, payout calculator, and
 * Monte Carlo RTP simulator.
 *
 * When `mode === 'with-bugs'`, the engine activates intentional iGaming bugs
 * used to verify that the automated test suite catches them:
 * - Bug #1 (banker-3-vs-8-draws): Banker with 3 draws a third card even when Player's third card is 8.
 * - Bug #2 (tie-forfeits-main-bets): A Tie outcome forfeits Player and Banker main bets instead of pushing.
 * - Bug #3 (banker-commission-truncation): Banker 1:0.95 payout truncates fractional dollars via Math.floor.
 * - Bug #4 (pair-requires-same-suit): Player/Banker Pair only triggers on identical rank AND suit.
 * - Bug #8 (biased-shoe-rng): Shoe dealing biases Player's initial hand toward naturals, skewing RTP > 105%.
 */

export const SUITS = ['S', 'H', 'D', 'C'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const TABLE_LIMITS = {
  player: { min: 10, max: 5000, odds: '1:1', label: 'Player' },
  banker: { min: 10, max: 5000, odds: '1:0.95', label: 'Banker' },
  tie: { min: 10, max: 1000, odds: '1:8', label: 'Tie' },
  playerPair: { min: 10, max: 1000, odds: '1:11', label: 'Player Pair' },
  bankerPair: { min: 10, max: 1000, odds: '1:11', label: 'Banker Pair' },
};

/** Theoretical 8-deck Baccarat probabilities and RTPs (standard combinatorial values). */
export const THEORETICAL_8_DECK = {
  probabilities: {
    banker: 0.458597,
    player: 0.446247,
    tie: 0.095156,
    playerPair: 0.074699,
    bankerPair: 0.074699,
  },
  rtp: {
    banker: 0.989421,
    player: 0.98765,
    tie: 0.856404,
    playerPair: 0.896388,
    bankerPair: 0.896388,
  },
};

/** Deterministic Mulberry32 PRNG for reproducible shoe simulations. */
export function createPrng(seed = 20261007) {
  let state = seed >>> 0;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Point value of a single card in Baccarat (A=1, 2..9=pip, 10/J/Q/K=0). */
export function cardValue(card) {
  if (card.rank === 'A') return 1;
  const num = Number(card.rank);
  return Number.isNaN(num) ? 0 : num === 10 ? 0 : num;
}

/** Modulo-10 point total of a Baccarat hand. */
export function handPoints(cards) {
  return cards.reduce((sum, card) => sum + cardValue(card), 0) % 10;
}

/** Builds and shuffles an 8-deck shoe (416 cards). */
export function createShoe(decks = 8, rand = Math.random) {
  const shoe = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        shoe.push({ suit, rank });
      }
    }
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = shoe[i];
    shoe[i] = shoe[j];
    shoe[j] = tmp;
  }
  return shoe;
}

/**
 * Determines whether Banker draws a third card according to the international
 * Punto Banco tableau.
 */
export function shouldBankerDraw(bankerInitial, playerThirdCard, mode = 'production') {
  if (!playerThirdCard) {
    return bankerInitial <= 5;
  }
  const p3 = cardValue(playerThirdCard);
  if (bankerInitial <= 2) return true;
  if (bankerInitial === 3) {
    // Bug #1: Banker with 3 erroneously draws even when Player's third card is 8.
    if (mode === 'with-bugs') return true;
    return p3 !== 8;
  }
  if (bankerInitial === 4) return p3 >= 2 && p3 <= 7;
  if (bankerInitial === 5) return p3 >= 4 && p3 <= 7;
  if (bankerInitial === 6) return p3 === 6 || p3 === 7;
  return false;
}

/**
 * Deals one complete Baccarat hand from `cards` (consumes 4 to 6 cards from the front)
 * and evaluates the winner, natural flag, and pair side-bets.
 */
export function dealBaccaratHand(cards, mode = 'production') {
  if (!Array.isArray(cards) || cards.length < 6) {
    throw new Error('At least 6 cards are required to deal a Baccarat hand.');
  }
  const p1 = cards.shift();
  const b1 = cards.shift();
  const p2 = cards.shift();
  const b2 = cards.shift();

  const playerCards = [p1, p2];
  const bankerCards = [b1, b2];

  const playerInitial = handPoints(playerCards);
  const bankerInitial = handPoints(bankerCards);
  const natural = playerInitial >= 8 || bankerInitial >= 8;

  let playerThird = null;

  if (!natural) {
    if (playerInitial <= 5) {
      playerThird = cards.shift();
      playerCards.push(playerThird);
    }
    if (shouldBankerDraw(bankerInitial, playerThird, mode)) {
      bankerCards.push(cards.shift());
    }
  }

  const playerPoints = handPoints(playerCards);
  const bankerPoints = handPoints(bankerCards);

  let outcome = 'tie';
  if (playerPoints > bankerPoints) outcome = 'player';
  else if (bankerPoints > playerPoints) outcome = 'banker';

  // Bug #4: Pair check in with-bugs mode requires identical suit in addition to identical rank.
  const isPair = (c1, c2) =>
    mode === 'with-bugs' ? c1.rank === c2.rank && c1.suit === c2.suit : c1.rank === c2.rank;

  return {
    playerCards,
    bankerCards,
    playerInitial,
    bankerInitial,
    playerPoints,
    bankerPoints,
    natural,
    outcome,
    playerPair: isPair(p1, p2),
    bankerPair: isPair(b1, b2),
  };
}

/**
 * Settles all active bets (in integer cents) against `hand`.
 * Returns per-zone settlement details and totals in cents.
 */
export function settleBets(betsInCents, hand, mode = 'production') {
  const lines = [];
  let totalWagerCents = 0;
  let totalReturnCents = 0;

  for (const zone of Object.keys(TABLE_LIMITS)) {
    const wagerCents = betsInCents[zone] ?? 0;
    if (wagerCents <= 0) continue;
    totalWagerCents += wagerCents;

    let payoutCents = 0;
    let status = 'lost';

    if (zone === 'player') {
      if (hand.outcome === 'player') {
        payoutCents = wagerCents * 2;
        status = 'won';
      } else if (hand.outcome === 'tie') {
        // Bug #2: Tie forfeits Player and Banker main bets instead of refunding (pushing) them.
        if (mode === 'with-bugs') {
          payoutCents = 0;
          status = 'lost';
        } else {
          payoutCents = wagerCents;
          status = 'push';
        }
      }
    } else if (zone === 'banker') {
      if (hand.outcome === 'banker') {
        // Bug #3: Truncates fractional dollars on the 5% commission instead of exact cent calculation.
        const profitCents =
          mode === 'with-bugs'
            ? Math.floor((wagerCents / 100) * 0.95) * 100
            : Math.round((wagerCents * 95) / 100);
        payoutCents = wagerCents + profitCents;
        status = 'won';
      } else if (hand.outcome === 'tie') {
        if (mode === 'with-bugs') {
          payoutCents = 0;
          status = 'lost';
        } else {
          payoutCents = wagerCents;
          status = 'push';
        }
      }
    } else if (zone === 'tie') {
      if (hand.outcome === 'tie') {
        payoutCents = wagerCents * 9;
        status = 'won';
      }
    } else if (zone === 'playerPair') {
      if (hand.playerPair) {
        payoutCents = wagerCents * 12;
        status = 'won';
      }
    } else if (zone === 'bankerPair') {
      if (hand.bankerPair) {
        payoutCents = wagerCents * 12;
        status = 'won';
      }
    }

    totalReturnCents += payoutCents;
    lines.push({
      zone,
      wagerCents,
      payoutCents,
      netCents: payoutCents - wagerCents,
      status,
    });
  }

  return {
    lines,
    totalWagerCents,
    totalReturnCents,
    netCents: totalReturnCents - totalWagerCents,
  };
}

/**
 * Runs a fast Monte Carlo simulation of `rounds` hands using 8-deck shoes
 * (reshuffling whenever fewer than 14 cards remain, standard cut-card rule)
 * and computes observed frequencies and RTPs for every bet zone.
 */
export function simulateRounds(rounds = 100_000, mode = 'production', seed = 20261007) {
  const rand = createPrng(seed);
  let shoe = createShoe(8, rand);

  const counts = {
    player: 0,
    banker: 0,
    tie: 0,
    playerPair: 0,
    bankerPair: 0,
  };

  for (let i = 0; i < rounds; i++) {
    if (shoe.length < 14) {
      shoe = createShoe(8, rand);
    }
    // Bug #8: Biased shoe dealing in with-bugs mode gives Player an extra natural 9 every 8th hand.
    if (mode === 'with-bugs' && i % 8 === 0) {
      shoe[0] = { suit: 'S', rank: '9' };
      shoe[2] = { suit: 'H', rank: '10' };
    }
    const hand = dealBaccaratHand(shoe, mode);
    counts[hand.outcome]++;
    if (hand.playerPair) counts.playerPair++;
    if (hand.bankerPair) counts.bankerPair++;
  }

  const probabilities = {
    banker: counts.banker / rounds,
    player: counts.player / rounds,
    tie: counts.tie / rounds,
    playerPair: counts.playerPair / rounds,
    bankerPair: counts.bankerPair / rounds,
  };

  // On Tie, main bets push in production (returned stake = 1x), or forfeit in with-bugs (0x).
  const tieMainReturn = mode === 'with-bugs' ? 0 : probabilities.tie;
  const rtp = {
    banker: probabilities.banker * 1.95 + tieMainReturn,
    player: probabilities.player * 2.0 + tieMainReturn,
    tie: probabilities.tie * 9.0,
    playerPair: probabilities.playerPair * 12.0,
    bankerPair: probabilities.bankerPair * 12.0,
  };

  return {
    rounds,
    seed,
    mode,
    counts,
    probabilities,
    rtp,
    theoretical: THEORETICAL_8_DECK,
  };
}
