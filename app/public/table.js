const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const ZONES = ['player', 'banker', 'tie', 'playerPair', 'bankerPair'];

const params = new URLSearchParams(window.location.search);
const sessionKey = 'baccarat-session-id';
let sessionId = params.get('session') || sessionStorage.getItem(sessionKey);
if (!sessionId) {
  sessionId = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  sessionStorage.setItem(sessionKey, sessionId);
}
const requestedMode = params.get('mode');

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

function showMessage(text) {
  const banner = document.querySelector('[data-test="table-message"]');
  if (!text) {
    banner.hidden = true;
    banner.textContent = '';
    return;
  }
  banner.hidden = false;
  banner.textContent = text;
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
  document.querySelector('[data-test="target-mode"]').textContent = state.mode.toUpperCase();
  const statusEl = document.querySelector('[data-test="table-status"]');
  statusEl.textContent = state.tableState;
  statusEl.className = `badge ${state.tableState === 'BETTING_OPEN' ? 'status-open' : 'status-closed'}`;

  document.querySelector('[data-test="wallet-balance"]').textContent = formatMoney(state.balance);
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
  const headers = { 'X-Session-Id': sessionId };
  if (requestedMode) headers['X-Target-Mode'] = requestedMode;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
    renderState(state);
  } catch (err) {
    showMessage(err.message);
  }
});

document.querySelector('[data-test="btn-reset"]').addEventListener('click', async () => {
  showMessage('');
  try {
    const state = await apiCall('/api/session/reset', 'POST', { balance: 1000 });
    renderState(state);
  } catch (err) {
    showMessage(err.message);
  }
});

window.refreshTableState = () => apiCall('/api/state').then(renderState);

window
  .refreshTableState()
  .catch((err) => showMessage(err.message));
