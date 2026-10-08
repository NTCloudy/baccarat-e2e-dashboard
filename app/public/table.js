import {
  createPrng,
  createShoe,
  dealBaccaratHand,
  settleBets,
  TABLE_LIMITS,
} from './engine.js';

const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const ZONES = ['player', 'banker', 'tie', 'playerPair', 'bankerPair'];

const params = new URLSearchParams(window.location.search);
const sessionKey = 'baccarat-session-id';
let sessionId = params.get('session') || sessionStorage.getItem(sessionKey);
if (!sessionId) {
  sessionId = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  sessionStorage.setItem(sessionKey, sessionId);
}
let currentMode = params.get('mode') === 'with-bugs' ? 'with-bugs' : 'production';

// Client-side engine fallback state when hosted statically on GitHub Pages (/table/) without a Node backend.
let staticMode = false;
let localSession = null;

function toDollars(cents) {
  return Number((cents / 100).toFixed(2));
}

function emptyBets() {
  return { player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 };
}

function withLocalLock(session, fn) {
  const next = session.lock.then(fn, fn);
  session.lock = next.catch(() => {});
  return next;
}

function createLocalSession(mode = currentMode, initialBalance = 1000) {
  const rand = createPrng(20261007);
  const initialCents = Math.round(initialBalance * 100);
  return {
    id: sessionId,
    mode,
    balanceCents: initialCents,
    tableState: 'BETTING_OPEN',
    betsCents: emptyBets(),
    roundNumber: 0,
    lastRound: null,
    beadRoad: [],
    ledger: [
      {
        id: 'TX-INIT',
        type: 'INIT',
        description: 'Initial wallet deposit',
        beforeCents: 0,
        deltaCents: initialCents,
        afterCents: initialCents,
        beforeBalance: 0,
        delta: toDollars(initialCents),
        afterBalance: toDollars(initialCents),
      },
    ],
    txCounter: 1,
    rand,
    shoe: createShoe(8, rand),
    lock: Promise.resolve(),
  };
}

function serializeLocalSession(session) {
  const bets = {};
  let totalBetCents = 0;
  for (const [zone, cents] of Object.entries(session.betsCents)) {
    bets[zone] = toDollars(cents);
    totalBetCents += cents;
  }
  return {
    sessionId: session.id,
    mode: session.mode,
    balanceCents: session.balanceCents,
    balance: toDollars(session.balanceCents),
    tableState: session.tableState,
    betsCents: { ...session.betsCents },
    bets,
    totalBet: toDollars(totalBetCents),
    roundNumber: session.roundNumber,
    lastRound: session.lastRound,
    beadRoad: session.beadRoad,
    ledger: session.ledger,
    shoeRemaining: session.shoe.length,
    shoeTotal: 416,
    cutCardAt: 14,
    limits: TABLE_LIMITS,
  };
}

async function handleLocalApi(path, method, body = {}) {
  if (!localSession) {
    localSession = createLocalSession(currentMode, 1000);
  }
  if (method === 'GET' && path === '/api/state') {
    return serializeLocalSession(localSession);
  }
  if (method === 'POST' && path === '/api/session/reset') {
    const balance = typeof body.balance === 'number' && body.balance >= 0 ? body.balance : 1000;
    const mode = body.mode === 'with-bugs' || body.mode === 'production' ? body.mode : localSession.mode;
    currentMode = mode;
    localSession = createLocalSession(mode, balance);
    return serializeLocalSession(localSession);
  }
  if (method === 'POST' && path === '/api/bets') {
    const { zone, amount } = body;
    const limit = TABLE_LIMITS[zone];
    if (!limit) throw new Error(`Unknown bet zone: ${String(zone)}`);
    const processBet = async () => {
      const amountCents = Math.round(Number(amount) * 100);
      if (amountCents < limit.min * 100) {
        throw new Error(`Bet amount $${amount} is below the minimum ($${limit.min}) for ${limit.label}`);
      }
      const nextZoneCents = localSession.betsCents[zone] + amountCents;
      if (nextZoneCents > limit.max * 100) {
        throw new Error(`Total bet $${toDollars(nextZoneCents)} exceeds the maximum ($${limit.max}) for ${limit.label}`);
      }
      const beforeCents = localSession.balanceCents;
      if (beforeCents < amountCents) {
        throw new Error('Insufficient wallet balance');
      }
      // Yield 15ms to simulate async DB I/O; without mutex lock (Bug #5 in with-bugs), concurrent requests race here.
      await new Promise((resolve) => setTimeout(resolve, 15));
      const afterCents = localSession.balanceCents - amountCents;
      localSession.balanceCents = afterCents;
      localSession.betsCents[zone] += amountCents;
      const txId = `TX-${String(localSession.txCounter++).padStart(4, '0')}`;
      localSession.ledger.push({
        id: txId,
        type: 'DEBIT',
        description: `Bet $${toDollars(amountCents)} on ${limit.label}`,
        beforeCents,
        deltaCents: -amountCents,
        afterCents,
        beforeBalance: toDollars(beforeCents),
        delta: -toDollars(amountCents),
        afterBalance: toDollars(afterCents),
      });
      return serializeLocalSession(localSession);
    };
    return localSession.mode === 'with-bugs'
      ? await processBet()
      : await withLocalLock(localSession, processBet);
  }
  if (method === 'POST' && path === '/api/bets/clear') {
    const totalRefundCents = Object.values(localSession.betsCents).reduce((a, b) => a + b, 0);
    if (totalRefundCents > 0) {
      const beforeCents = localSession.balanceCents;
      const afterCents = beforeCents + totalRefundCents;
      localSession.balanceCents = afterCents;
      localSession.betsCents = emptyBets();
      const txId = `TX-${String(localSession.txCounter++).padStart(4, '0')}`;
      localSession.ledger.push({
        id: txId,
        type: 'REFUND',
        description: 'Cleared table bets',
        beforeCents,
        deltaCents: totalRefundCents,
        afterCents,
        beforeBalance: toDollars(beforeCents),
        delta: toDollars(totalRefundCents),
        afterBalance: toDollars(afterCents),
      });
    }
    return serializeLocalSession(localSession);
  }
  if (method === 'POST' && path === '/api/deal') {
    if (localSession.shoe.length < 14) {
      localSession.shoe = createShoe(8, localSession.rand);
    }
    const usingCustomDeck = Array.isArray(body.deck) && body.deck.length >= 6;
    const cards = usingCustomDeck
      ? body.deck.map((c) => ({ suit: c.suit, rank: String(c.rank) }))
      : localSession.shoe;
    const hand = dealBaccaratHand(cards, localSession.mode);
    if (usingCustomDeck) {
      const dealtCount = hand.playerCards.length + hand.bankerCards.length;
      localSession.shoe.splice(0, dealtCount);
    }
    const settlement = settleBets(localSession.betsCents, hand, localSession.mode);
    if (settlement.totalReturnCents > 0) {
      const beforeCents = localSession.balanceCents;
      const afterCents = beforeCents + settlement.totalReturnCents;
      localSession.balanceCents = afterCents;
      const txId = `TX-${String(localSession.txCounter++).padStart(4, '0')}`;
      localSession.ledger.push({
        id: txId,
        type: 'PAYOUT',
        description: `Round #${localSession.roundNumber + 1} settlement (${hand.outcome.toUpperCase()})`,
        beforeCents,
        deltaCents: settlement.totalReturnCents,
        afterCents,
        beforeBalance: toDollars(beforeCents),
        delta: toDollars(settlement.totalReturnCents),
        afterBalance: toDollars(afterCents),
      });
    }
    localSession.roundNumber += 1;
    localSession.lastRound = {
      round: localSession.roundNumber,
      playerCards: hand.playerCards,
      bankerCards: hand.bankerCards,
      playerPoints: hand.playerPoints,
      bankerPoints: hand.bankerPoints,
      natural: hand.natural,
      outcome: hand.outcome,
      playerPair: hand.playerPair,
      bankerPair: hand.bankerPair,
    };
    localSession.beadRoad.push({
      round: localSession.roundNumber,
      outcome: hand.outcome,
      playerPoints: hand.playerPoints,
      bankerPoints: hand.bankerPoints,
      natural: hand.natural,
      playerPair: hand.playerPair,
      bankerPair: hand.bankerPair,
    });
    localSession.betsCents = emptyBets();
    localSession.tableState = 'BETTING_OPEN';
    return serializeLocalSession(localSession);
  }
  throw new Error(`Unsupported route: ${path}`);
}

let selectedChip = 25;
const chipButtons = document.querySelectorAll('[data-chip]');
chipButtons.forEach((btn) => {
  if (Number(btn.dataset.chip) === selectedChip) btn.classList.add('active');
  else btn.classList.remove('active');
  btn.addEventListener('click', () => {
    selectedChip = Number(btn.dataset.chip);
    chipButtons.forEach((b) => b.classList.toggle('active', b === btn));
  });
});

function formatMoney(amount) {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(Number(amount)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function showMessage(text, isPositive = false) {
  const banner = document.querySelector('[data-test="table-message"]');
  if (!text) {
    banner.hidden = true;
    banner.textContent = '';
    banner.classList.remove('message-ok');
    return;
  }
  banner.hidden = false;
  banner.textContent = text;
  banner.classList.toggle('message-ok', isPositive);
}

function renderCards(container, cards) {
  container.innerHTML = '';
  for (const card of cards || []) {
    const el = document.createElement('div');
    const isRed = card.suit === 'H' || card.suit === 'D';
    el.className = `playing-card${isRed ? ' red-suit' : ''}`;
    el.dataset.test = 'card-item';
    el.textContent = `${SUIT_SYMBOL[card.suit] ?? card.suit}${card.rank}`;
    container.appendChild(el);
  }
}

function renderState(state) {
  currentMode = state.mode;
  document.querySelector('[data-test="target-mode"]').textContent = state.mode.toUpperCase();
  document.querySelectorAll('[data-mode-select]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.modeSelect === state.mode);
  });

  const statusEl = document.querySelector('[data-test="table-status"]');
  statusEl.textContent = state.tableState;
  statusEl.className = `badge ${state.tableState === 'BETTING_OPEN' ? 'status-open' : 'status-closed'}`;

  const shoeEl = document.querySelector('[data-test="shoe-counter"]');
  if (shoeEl) {
    shoeEl.textContent = `${state.shoeRemaining ?? 416} / ${state.shoeTotal ?? 416}`;
  }

  const walletEl = document.querySelector('[data-test="wallet-balance"]');
  walletEl.textContent = formatMoney(state.balance);
  walletEl.classList.toggle('wallet-negative', Number(state.balance) < 0);

  document.querySelector('[data-test="total-bet"]').textContent = formatMoney(state.totalBet);

  for (const zone of ZONES) {
    const stakeEl = document.querySelector(`[data-test="bet-amount-${zone}"]`);
    if (stakeEl) stakeEl.textContent = formatMoney(state.bets[zone] ?? 0);
  }

  const last = state.lastRound;
  if (last) {
    document.querySelector('[data-test="player-points"]').textContent = String(last.playerPoints);
    document.querySelector('[data-test="banker-points"]').textContent = String(last.bankerPoints);
    renderCards(document.querySelector('[data-test="player-cards"]'), last.playerCards);
    renderCards(document.querySelector('[data-test="banker-cards"]'), last.bankerCards);
    const outcomeLabels = {
      player: 'PLAYER WINS (閒贏)',
      banker: 'BANKER WINS (莊贏)',
      tie: 'TIE GAME (和局)',
    };
    document.querySelector('[data-test="round-outcome"]').textContent =
      outcomeLabels[last.outcome] ?? last.outcome.toUpperCase();
  } else {
    document.querySelector('[data-test="player-points"]').textContent = '—';
    document.querySelector('[data-test="banker-points"]').textContent = '—';
    renderCards(document.querySelector('[data-test="player-cards"]'), []);
    renderCards(document.querySelector('[data-test="banker-cards"]'), []);
    document.querySelector('[data-test="round-outcome"]').textContent = 'PLACE YOUR BETS';
  }

  const roadEl = document.querySelector('[data-test="bead-road"]');
  roadEl.innerHTML = '';
  for (const item of state.beadRoad || []) {
    const cell = document.createElement('div');
    cell.className = `bead-cell bead-${item.outcome}`;
    cell.dataset.test = 'bead-item';
    cell.dataset.outcome = item.outcome;
    const letter = item.outcome === 'banker' ? 'B' : item.outcome === 'player' ? 'P' : 'T';
    cell.textContent = `${letter}${item.outcome === 'banker' ? item.bankerPoints : item.playerPoints}`;
    roadEl.appendChild(cell);
  }

  const tbody = document.querySelector('[data-test="ledger-rows"]');
  tbody.innerHTML = '';
  for (const entry of [...(state.ledger || [])].reverse()) {
    const tr = document.createElement('tr');
    tr.dataset.test = 'ledger-row';
    tr.innerHTML = `
      <td data-test="ledger-id">${entry.id}</td>
      <td data-test="ledger-type">${entry.type}</td>
      <td data-test="ledger-desc">${entry.description}</td>
      <td data-test="ledger-before">${formatMoney(entry.beforeBalance)}</td>
      <td data-test="ledger-delta">${formatMoney(entry.delta)}</td>
      <td data-test="ledger-after">${formatMoney(entry.afterBalance)}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function apiCall(path, method = 'GET', body = undefined) {
  if (staticMode) {
    return handleLocalApi(path, method, body);
  }
  const headers = { 'X-Session-Id': sessionId, 'X-Target-Mode': currentMode };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    staticMode = true;
    return handleLocalApi(path, method, body);
  }
  const contentType = res.headers.get('content-type') || '';
  if (res.status === 404 && !contentType.includes('application/json')) {
    staticMode = true;
    return handleLocalApi(path, method, body);
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

document.querySelectorAll('.bet-zone').forEach((btn) => {
  btn.addEventListener('click', async () => {
    showMessage('');
    try {
      const state = await apiCall('/api/bets', 'POST', {
        zone: btn.dataset.zone,
        amount: selectedChip,
      });
      renderState(state);
    } catch (err) {
      showMessage(err.message);
    }
  });
});

document.querySelector('[data-test="btn-clear"]').addEventListener('click', async () => {
  showMessage('');
  try {
    const state = await apiCall('/api/bets/clear', 'POST', {});
    renderState(state);
  } catch (err) {
    showMessage(err.message);
  }
});

document.querySelector('[data-test="btn-deal"]').addEventListener('click', async () => {
  showMessage('');
  try {
    const dealOverride = window.__TEST_DECK__ ? { deck: window.__TEST_DECK__ } : {};
    const state = await apiCall('/api/deal', 'POST', dealOverride);
    window.__TEST_DECK__ = undefined;
    renderState(state);
  } catch (err) {
    showMessage(err.message);
  }
});

document.querySelector('[data-test="btn-reset"]').addEventListener('click', async () => {
  showMessage('');
  try {
    const state = await apiCall('/api/session/reset', 'POST', { balance: 1000, mode: currentMode });
    renderState(state);
  } catch (err) {
    showMessage(err.message);
  }
});

document.querySelectorAll('[data-mode-select]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    showMessage('');
    currentMode = btn.dataset.modeSelect;
    try {
      const state = await apiCall('/api/session/reset', 'POST', { balance: 1000, mode: currentMode });
      renderState(state);
    } catch (err) {
      showMessage(err.message);
    }
  });
});

const PRESET_SCENARIOS = {
  natural9: {
    zone: 'player',
    amount: 100,
    deck: [
      { suit: 'S', rank: '5' },
      { suit: 'D', rank: '3' },
      { suit: 'H', rank: '4' },
      { suit: 'C', rank: '3' },
      { suit: 'S', rank: '10' },
      { suit: 'H', rank: '10' },
    ],
  },
  banker3vs8: {
    zone: 'banker',
    amount: 100,
    deck: [
      { suit: 'S', rank: '2' },
      { suit: 'D', rank: '2' },
      { suit: 'H', rank: '2' },
      { suit: 'C', rank: 'A' },
      { suit: 'S', rank: '8' },
      { suit: 'H', rank: '6' },
    ],
  },
  tiePush: {
    zone: 'player',
    amount: 100,
    deck: [
      { suit: 'S', rank: '4' },
      { suit: 'D', rank: '4' },
      { suit: 'H', rank: '3' },
      { suit: 'C', rank: '3' },
      { suit: 'S', rank: '10' },
      { suit: 'H', rank: '10' },
    ],
  },
  commission35: {
    zone: 'banker',
    amount: 35,
    deck: [
      { suit: 'S', rank: '3' },
      { suit: 'D', rank: '5' },
      { suit: 'H', rank: '3' },
      { suit: 'C', rank: '4' },
      { suit: 'S', rank: '10' },
      { suit: 'H', rank: '10' },
    ],
  },
  mixedPair: {
    zone: 'playerPair',
    amount: 25,
    deck: [
      { suit: 'S', rank: '8' },
      { suit: 'D', rank: '4' },
      { suit: 'H', rank: '8' },
      { suit: 'C', rank: '3' },
      { suit: 'S', rank: '10' },
      { suit: 'H', rank: '10' },
    ],
  },
};

document.querySelectorAll('[data-preset]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const scenario = PRESET_SCENARIOS[btn.dataset.preset];
    if (!scenario) return;
    showMessage('');
    try {
      await apiCall('/api/bets/clear', 'POST', {});
      await apiCall('/api/bets', 'POST', { zone: scenario.zone, amount: scenario.amount });
      const state = await apiCall('/api/deal', 'POST', { deck: scenario.deck });
      renderState(state);
    } catch (err) {
      showMessage(err.message);
    }
  });
});

document.querySelectorAll('[data-preset-race]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    showMessage('');
    try {
      await apiCall('/api/session/reset', 'POST', { balance: 200, mode: currentMode });
      const settled = await Promise.allSettled(
        [1, 2, 3, 4, 5].map(() => apiCall('/api/bets', 'POST', { zone: 'player', amount: 200 })),
      );
      const accepted = settled.filter((r) => r.status === 'fulfilled').length;
      const rejected = settled.length - accepted;
      const state = await apiCall('/api/state');
      renderState(state);
      if (state.balance < 0) {
        showMessage(
          `✕ [TC14 Bug #5 競態超扣重現] 錢包僅有 $200.00，同時發送 5 筆 $200 注單：因未加互斥鎖，${accepted} 筆全數闖關成功，餘額被扣成負數 ${formatMoney(state.balance)}！`,
          false,
        );
      } else {
        showMessage(
          `✓ [TC14 PRODUCTION 互斥鎖生效] 錢包僅有 $200.00，同時發送 5 筆 $200 注單：僅 ${accepted} 筆扣款成功、${rejected} 筆因餘額不足被擋下，餘額安全維持 ${formatMoney(state.balance)}。`,
          true,
        );
      }
    } catch (err) {
      showMessage(err.message);
    }
  });
});

window.refreshTableState = () => apiCall('/api/state').then(renderState);

window
  .refreshTableState()
  .catch((err) => showMessage(err.message));
