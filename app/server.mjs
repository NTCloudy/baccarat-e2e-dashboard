#!/usr/bin/env node
/**
 * Self-contained Baccarat Table & Seamless Wallet HTTP server (SUT).
 * Serves both the interactive table UI (app/public/) and the JSON REST API (/api/*).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPrng,
  createShoe,
  dealBaccaratHand,
  settleBets,
  simulateRounds,
  TABLE_LIMITS,
} from './engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

const port = Number(process.env.PORT ?? 4100);
const defaultMode = process.env.TARGET === 'with-bugs' ? 'with-bugs' : 'production';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const sessions = new Map();

function toDollars(cents) {
  return Number((cents / 100).toFixed(2));
}

function emptyBets() {
  return { player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 };
}

function createSession(id, mode = defaultMode, initialBalance = 1000) {
  const rand = createPrng(20261007);
  const initialCents = Math.round(initialBalance * 100);
  return {
    id,
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
    processedKeys: new Map(),
    txCounter: 1,
    rand,
    shoe: createShoe(8, rand),
    lock: Promise.resolve(),
  };
}

function getSession(req, url) {
  const id =
    req.headers['x-session-id'] ||
    url.searchParams.get('session') ||
    'default';
  const requestedMode = req.headers['x-target-mode'] || url.searchParams.get('mode');
  if (!sessions.has(id)) {
    const mode = requestedMode === 'with-bugs' || requestedMode === 'production' ? requestedMode : defaultMode;
    sessions.set(id, createSession(String(id), mode));
  }
  const session = sessions.get(id);
  if (requestedMode === 'with-bugs' || requestedMode === 'production') {
    session.mode = requestedMode;
  }
  return session;
}

/** Runs `fn` exclusively for `session` to prevent concurrent wallet race conditions. */
function withLock(session, fn) {
  const next = session.lock.then(fn, fn);
  session.lock = next.catch(() => {});
  return next;
}

function serializeSession(session) {
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
    limits: TABLE_LIMITS,
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function handleApi(req, res, url) {
  const session = getSession(req, url);

  if (req.method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, serializeSession(session));
  }

  let body = {};
  if (req.method === 'POST') {
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: 'Invalid JSON request body', code: 'INVALID_JSON' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/session/reset') {
    const balance = typeof body.balance === 'number' && body.balance >= 0 ? body.balance : 1000;
    const mode =
      body.mode === 'with-bugs' || body.mode === 'production' ? body.mode : session.mode;
    const fresh = createSession(session.id, mode, balance);
    sessions.set(session.id, fresh);
    return sendJson(res, 200, serializeSession(fresh));
  }

  if (req.method === 'POST' && url.pathname === '/api/table/state') {
    const nextState = body.state;
    if (nextState !== 'BETTING_OPEN' && nextState !== 'BETTING_CLOSED') {
      return sendJson(res, 400, { error: 'Invalid table state', code: 'INVALID_STATE' });
    }
    session.tableState = nextState;
    return sendJson(res, 200, serializeSession(session));
  }

  if (req.method === 'POST' && url.pathname === '/api/bets') {
    const { zone, amount, idempotencyKey } = body;
    const limit = TABLE_LIMITS[zone];
    if (!limit) {
      return sendJson(res, 400, { error: `Unknown bet zone: ${String(zone)}`, code: 'INVALID_ZONE' });
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return sendJson(res, 400, { error: 'Bet amount must be a positive number', code: 'INVALID_AMOUNT' });
    }

    const processBet = async () => {
      // Bug #7: In with-bugs mode, late bets after BETTING_CLOSED are erroneously accepted.
      if (session.mode !== 'with-bugs' && session.tableState !== 'BETTING_OPEN') {
        return {
          status: 409,
          payload: { error: 'Betting is closed for the current round', code: 'BETTING_CLOSED' },
        };
      }

      // Bug #6: In with-bugs mode, idempotencyKey is ignored so duplicate retries double-charge.
      if (session.mode !== 'with-bugs' && idempotencyKey && session.processedKeys.has(idempotencyKey)) {
        const cached = session.processedKeys.get(idempotencyKey);
        return {
          status: 200,
          payload: { ...serializeSession(session), deduplicated: true, transactionId: cached.transactionId },
        };
      }

      const amountCents = Math.round(amount * 100);
      if (amountCents < limit.min * 100) {
        return {
          status: 400,
          payload: {
            error: `Bet amount $${amount} is below the minimum ($${limit.min}) for ${limit.label}`,
            code: 'BELOW_MIN_BET',
          },
        };
      }

      const nextZoneCents = session.betsCents[zone] + amountCents;
      if (nextZoneCents > limit.max * 100) {
        return {
          status: 400,
          payload: {
            error: `Total bet $${toDollars(nextZoneCents)} exceeds the maximum ($${limit.max}) for ${limit.label}`,
            code: 'ABOVE_MAX_BET',
          },
        };
      }

      // Read wallet balance before checking sufficient funds.
      const beforeCents = session.balanceCents;
      if (beforeCents < amountCents) {
        return {
          status: 400,
          payload: { error: 'Insufficient wallet balance', code: 'INSUFFICIENT_BALANCE' },
        };
      }

      // Yield briefly to simulate async DB/ledger I/O; without a session lock (Bug #5), concurrent requests race here.
      await new Promise((resolve) => setTimeout(resolve, 15));

      const afterCents = session.balanceCents - amountCents;
      session.balanceCents = afterCents;
      session.betsCents[zone] += amountCents;

      const txId = `TX-${String(session.txCounter++).padStart(4, '0')}`;
      session.ledger.push({
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

      if (idempotencyKey) {
        session.processedKeys.set(idempotencyKey, { transactionId: txId });
      }

      return {
        status: 200,
        payload: { ...serializeSession(session), deduplicated: false, transactionId: txId },
      };
    };

    // Bug #5: In with-bugs mode, concurrent bets bypass the per-session mutex lock.
    const result =
      session.mode === 'with-bugs' ? await processBet() : await withLock(session, processBet);
    return sendJson(res, result.status, result.payload);
  }

  if (req.method === 'POST' && url.pathname === '/api/bets/clear') {
    if (session.tableState !== 'BETTING_OPEN') {
      return sendJson(res, 409, { error: 'Cannot clear bets after betting is closed', code: 'BETTING_CLOSED' });
    }
    const totalRefundCents = Object.values(session.betsCents).reduce((a, b) => a + b, 0);
    if (totalRefundCents > 0) {
      const beforeCents = session.balanceCents;
      const afterCents = beforeCents + totalRefundCents;
      session.balanceCents = afterCents;
      session.betsCents = emptyBets();
      const txId = `TX-${String(session.txCounter++).padStart(4, '0')}`;
      session.ledger.push({
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
    return sendJson(res, 200, serializeSession(session));
  }

  if (req.method === 'POST' && url.pathname === '/api/deal') {
    const dealResult = await withLock(session, async () => {
      session.tableState = 'BETTING_CLOSED';
      let cards;
      if (Array.isArray(body.deck) && body.deck.length >= 6) {
        cards = body.deck.map((c) => ({ suit: c.suit, rank: String(c.rank) }));
      } else {
        if (session.shoe.length < 14) {
          session.shoe = createShoe(8, session.rand);
        }
        cards = session.shoe;
      }

      const hand = dealBaccaratHand(cards, session.mode);
      const settlement = settleBets(session.betsCents, hand, session.mode);

      if (settlement.totalReturnCents > 0) {
        const beforeCents = session.balanceCents;
        const afterCents = beforeCents + settlement.totalReturnCents;
        session.balanceCents = afterCents;
        const txId = `TX-${String(session.txCounter++).padStart(4, '0')}`;
        session.ledger.push({
          id: txId,
          type: 'PAYOUT',
          description: `Round #${session.roundNumber + 1} settlement (${hand.outcome.toUpperCase()})`,
          beforeCents,
          deltaCents: settlement.totalReturnCents,
          afterCents,
          beforeBalance: toDollars(beforeCents),
          delta: toDollars(settlement.totalReturnCents),
          afterBalance: toDollars(afterCents),
        });
      }

      session.roundNumber += 1;
      const roundSummary = {
        round: session.roundNumber,
        playerCards: hand.playerCards,
        bankerCards: hand.bankerCards,
        playerInitial: hand.playerInitial,
        bankerInitial: hand.bankerInitial,
        playerPoints: hand.playerPoints,
        bankerPoints: hand.bankerPoints,
        natural: hand.natural,
        outcome: hand.outcome,
        playerPair: hand.playerPair,
        bankerPair: hand.bankerPair,
        settlement: {
          totalWager: toDollars(settlement.totalWagerCents),
          totalReturn: toDollars(settlement.totalReturnCents),
          netWin: toDollars(settlement.netCents),
          lines: settlement.lines.map((l) => ({
            zone: l.zone,
            wager: toDollars(l.wagerCents),
            payout: toDollars(l.payoutCents),
            net: toDollars(l.netCents),
            status: l.status,
          })),
        },
      };

      session.lastRound = roundSummary;
      session.beadRoad.push({
        round: session.roundNumber,
        outcome: hand.outcome,
        playerPoints: hand.playerPoints,
        bankerPoints: hand.bankerPoints,
        natural: hand.natural,
        playerPair: hand.playerPair,
        bankerPair: hand.bankerPair,
      });
      session.betsCents = emptyBets();
      session.tableState = 'BETTING_OPEN';
      return roundSummary;
    });

    return sendJson(res, 200, {
      ...serializeSession(session),
      round: dealResult,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/simulate') {
    const rounds = Math.min(Math.max(Number(body.rounds ?? 100_000), 100), 500_000);
    const seed = Number(body.seed ?? 20261007);
    const mode = body.mode === 'with-bugs' || body.mode === 'production' ? body.mode : session.mode;
    const report = simulateRounds(rounds, mode, seed);
    return sendJson(res, 200, report);
  }

  return sendJson(res, 404, { error: `Unknown API route: ${url.pathname}`, code: 'NOT_FOUND' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);

  if (url.pathname.startsWith('/api/')) {
    return handleApi(req, res, url);
  }

  if (url.pathname === '/engine.js') {
    const enginePath = path.join(__dirname, 'engine.mjs');
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    fs.createReadStream(enginePath).pipe(res);
    return;
  }

  const relPath = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const filePath = path.resolve(publicDir, relPath);
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`Baccarat table server listening on http://localhost:${port} (default mode: ${defaultMode})`);
});
