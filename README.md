# Baccarat & Seamless Wallet QA Automation Dashboard

[![E2E tests](https://github.com/NTCloudy/baccarat-e2e-dashboard/actions/workflows/e2e.yml/badge.svg)](https://github.com/NTCloudy/baccarat-e2e-dashboard/actions/workflows/e2e.yml)
[![CI](https://github.com/NTCloudy/baccarat-e2e-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/NTCloudy/baccarat-e2e-dashboard/actions/workflows/ci.yml)
[![Live Dashboard](https://img.shields.io/badge/GitHub%20Pages-Live%20Dashboard-0d5c3a?logo=github)](https://ntcloudy.github.io/baccarat-e2e-dashboard/)

**English** | [繁體中文](./README.zh-TW.md)

An end-to-end **iGaming / Casino QA Automation** portfolio project built with **Playwright + TypeScript**. It tests a self-contained **Classic 8-Deck Baccarat (Punto Banco) Table & Seamless Wallet Engine** across UI workflows, REST API security, high-concurrency wallet race conditions, idempotency deduplication, and a **100,000-round Monte Carlo Return-to-Player (RTP)** statistical simulation.

- **Live QA Dashboard**: [https://ntcloudy.github.io/baccarat-e2e-dashboard/](https://ntcloudy.github.io/baccarat-e2e-dashboard/)
- **Bug Detection Report (`with-bugs`)**: [https://ntcloudy.github.io/baccarat-e2e-dashboard/#/bugs](https://ntcloudy.github.io/baccarat-e2e-dashboard/#/bugs)
- **Interactive Test Console**: [https://ntcloudy.github.io/baccarat-e2e-dashboard/#/console](https://ntcloudy.github.io/baccarat-e2e-dashboard/#/console)

---

## Why This Project? (5 Core iGaming QA Pillars)

In online casino and sportsbook engineering, UI happy-path tests are not enough—a single rounding error in commission, a missing third-card branch, or an unlocked concurrent wallet debit can cause severe financial or regulatory loss. This test suite verifies five mission-critical iGaming pillars:

1. **Punto Banco Third-Card Tableau (`TC01`–`TC06`)**
   Deterministic shoe injection exercises every branch of the international 8-deck Baccarat drawing rules: Natural 8/9 immediate stand (`TC01`), Player draw `0–5` vs stand `6–7` (`TC02`), Banker `0–2` mandatory draw (`TC03`), **Banker `3` standing only when Player's third card is `8`** (`TC04`), Banker `4` / `5` conditional drawing windows (`TC05`), and Banker `6` drawing only against Player third card `6–7` vs Banker `7` standing (`TC06`).
2. **Payout & 5% Banker Commission Cent-Precision (`TC07`–`TC11`)**
   All wallet arithmetic runs in integer cents (`1 USD = 100 cents`) to prevent IEEE-754 floating-point drift:
   - `1:1` Player win & losing Banker bet forfeiture (`TC07`)
   - `1:0.95` Banker win with fractional 5% commission (`$35` wager → `$33.25` net profit, `$68.25` total return) (`TC08`)
   - `1:8` Tie payout with mandatory **Push (refund)** of Player and Banker main bets (`TC09`)
   - `1:11` Player Pair & Banker Pair side bets across mixed suits (`♠K` + `♥K`) and non-pairs (`TC10`)
   - Multi-zone combined settlement in a single round (`TC11`)
3. **Seamless Wallet Concurrency, Idempotency & State Machine Guards (`TC12`–`TC16`)**
   - Full `DEBIT` / `CREDIT` transaction ledger audit with `before` / `after` balance invariants (`TC12`)
   - Table min/max wager limits (`$10`–`$5,000`) and insufficient-balance rejection (`TC13`)
   - **High-Concurrency Race Condition (`TC14`)**: Fires `N` simultaneous all-in `POST /api/bets` via `Promise.all` against a `$200` balance to verify the per-session async mutex (`withLock`) allows exactly 1 debit and prevents negative-balance overdrafts
   - **Network Retry Idempotency (`TC15`)**: Replays 3 identical `idempotencyKey` requests and verifies exact-once wallet deduction
   - **Late-Bet State Machine Guard (`TC16`)**: Verifies `POST /api/bets` returns `409 BETTING_CLOSED` once the betting countdown closes
4. **Casino Table UI & Bead Road (`TC17`–`TC19`)**
   - Chip rack selection (`$10`, `$25`, `$100`, `$500`), multi-zone chip stacking, and `Clear Bets` refund (`TC17`)
   - **Bead Road (`珠盤路`)** chronological recording (`P` / `B` / `T` markers, Natural `N` ring, Player/Banker Pair dots) (`TC18`)
   - 8-deck shoe (416 cards), burn card, and automatic reshuffle when remaining cards cross the cut-card threshold (`TC19`)
5. **100,000-Round Monte Carlo RTP & Probability Verification (`TC20`)**
   Runs 100,000 continuous 8-deck hands via `/api/simulate` (and embeds the full statistical report into every run on the dashboard) to verify empirical probabilities and Return-to-Player converge within `±0.50%` of theoretical 8-deck Punto Banco mathematics:
   - **Banker RTP**: `98.94%` (House Edge `1.06%`)
   - **Player RTP**: `98.76%` (House Edge `1.24%`)
   - **Tie RTP**: `85.64%` (House Edge `14.36%`)
   - **Player / Banker Pair RTP**: `89.64%` (House Edge `10.36%`)

---

## Fault-Injection Mode (`with-bugs`) & 8 Planted iGaming Defects

The built-in game and wallet server supports two modes via `TARGET`:
- `TARGET=production`: Standard compliant engine—all **20 / 20** test cases pass (`100%`).
- `TARGET=with-bugs`: Injects **8 real-world iGaming defects** into the rules engine, payout calculator, wallet lock, and shoe RNG. Running the exact same test suite intercepts **8 / 8** defects and classifies each failure against [`config/known-bugs.json`](./config/known-bugs.json):

| Bug | Severity | Detected By | Defect Summary | Issue & Evidence |
| :--- | :---: | :---: | :--- | :---: |
| **#1** | High | `TC04` | **Third-card tableau bug**: Banker on initial `3` erroneously draws a third card when Player's third card is `8` | [Issue #1](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/1) · [Screenshot](./docs/bugs/bug-1.png) |
| **#2** | High | `TC09` | **Tie settlement bug**: Tie outcome pays `1:8` on Tie but forfeits Player and Banker main bets instead of pushing | [Issue #2](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/2) · [Screenshot](./docs/bugs/bug-2.png) |
| **#3** | High | `TC08` | **Banker 5% commission bug**: `1:0.95` payout uses `Math.floor` on dollars, truncating `$0.25` on a `$35` Banker win (`$68.00` instead of `$68.25`) | [Issue #3](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/3) · [Screenshot](./docs/bugs/bug-3.png) |
| **#4** | Medium | `TC10` | **Pair side-bet bug**: Pair check requires identical suit in addition to identical rank, failing to pay mixed-suit pairs (`♠K` + `♥K`) | [Issue #4](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/4) · [Screenshot](./docs/bugs/bug-4.png) |
| **#5** | High | `TC14` | **Wallet race condition**: Concurrent bets bypass per-session mutex locking, allowing 5 simultaneous `$200` bets on a `$200` balance to overdraw to `-$800.00` | [Issue #5](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/5) · [Screenshot](./docs/bugs/bug-5.png) |
| **#6** | High | `TC15` | **Idempotency failure**: Duplicate bet retries with the same `idempotencyKey` are not deduplicated and debit the wallet 3 times | [Issue #6](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/6) · [Screenshot](./docs/bugs/bug-6.png) |
| **#7** | High | `TC16` | **Late-bet vulnerability**: `POST /api/bets` accepts wagers even after `tableState` transitions to `BETTING_CLOSED` | [Issue #7](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/7) · [Screenshot](./docs/bugs/bug-7.png) |
| **#8** | High | `TC20` | **Biased shoe RNG**: Shoe deals excess Player Natural 9 hands every 8th round, skewing 100k-round Player RTP above `110%` | [Issue #8](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/8) · [Screenshot](./docs/bugs/bug-8.png) |

---

## Test Catalog (`TC01`–`TC20`)

| ID | Module | Test Case | Adjustable Test Data (`config/cases.json`) |
| :---: | :---: | :--- | :--- |
| `TC01` | Tableau | Natural 8 / 9 immediate stand (no third card drawn) | — |
| `TC02` | Tableau | Player draws on `0–5` and stands on `6–7`; Banker responds when Player stands | — |
| `TC03` | Tableau | Banker initial `0–2` always draws a third card regardless of Player's third card | — |
| `TC04` | Tableau | Banker initial `3` stands vs Player third card `8` and draws vs all other cards | — |
| `TC05` | Tableau | Banker initial `4` draws only vs Player `2–7`; Banker `5` draws only vs Player `4–7` | — |
| `TC06` | Tableau | Banker initial `6` draws only vs Player `6–7`; Banker `7` always stands | — |
| `TC07` | Payout | Player win pays `1:1` and forfeits losing Banker bet | `amount` (default `$50`) |
| `TC08` | Payout | Banker win pays `1:0.95` (5% commission) with exact cent precision | `amount` (default `$35`) |
| `TC09` | Payout | Tie outcome pays `1:8` on Tie and pushes (refunds) Player & Banker main bets | `tieBet` (`$20`), `mainBet` (`$50`) |
| `TC10` | Payout | Player Pair & Banker Pair side bets pay `1:11` on mixed-suit pairs | `amount` (default `$20`) |
| `TC11` | Payout | Multi-zone combined bet settlement in a single round | — |
| `TC12` | Wallet | Seamless Wallet `DEBIT` / `CREDIT` ledger audit and balance invariants | — |
| `TC13` | Wallet | Table min/max limit (`$10`–`$5,000`) and insufficient-balance guards | — |
| `TC14` | Wallet | Concurrent all-in race-condition protection (per-session mutex lock) | `concurrency` (default `5`) |
| `TC15` | Wallet | Idempotency Key deduplication on network retry (`X-Idempotency-Key`) | `amount` (default `$50`) |
| `TC16` | Wallet | State machine rejects late API bets when `tableState === 'BETTING_CLOSED'` | — |
| `TC17` | Table & RTP | Chip rack selection, multi-zone chip stacking, and `Clear Bets` refund | — |
| `TC18` | Table & RTP | Bead Road (`珠盤路`) chronological history with Natural & Pair markers | — |
| `TC19` | Table & RTP | 8-deck shoe card counter and automatic cut-card reshuffle | — |
| `TC20` | Table & RTP | 100,000-round Monte Carlo simulation verifies RTP & outcome probabilities | `rounds` (default `100,000`) |

---

## Project Structure

```text
├── app/
│   ├── engine.mjs              # 8-deck Punto Banco engine, cent-precision payout & 100k Monte Carlo simulator
│   ├── server.mjs              # Zero-dependency Node.js Seamless Wallet & Table HTTP server (port 4100)
│   └── public/                 # Emerald-and-gold VIP Baccarat table Web UI (HTML/CSS/JS)
├── config/
│   ├── cases.json              # Parameterized test data definitions & validation bounds
│   ├── descriptions.json       # Bilingual (zh-TW / EN) test case titles & descriptions
│   └── known-bugs.json         # 8 planted iGaming bugs (#1–#8) + out-of-scope architecture matrix
├── src/
│   ├── api/baccaratApi.ts      # Typed Seamless Wallet & Table API client (with deterministic shoe injection)
│   ├── pages/TablePage.ts      # Playwright Page Object for the Baccarat table UI
│   ├── support/                # Target mode & parameterized test data helpers
│   └── fixtures.ts             # Isolated per-test session ID & wallet fixture
├── tests/
│   ├── 01-tableau.spec.ts      # TC01–TC06: Punto Banco third-card drawing rules
│   ├── 02-payout.spec.ts       # TC07–TC11: Payouts, 5% commission cent accuracy & Tie push
│   ├── 03-wallet.spec.ts       # TC12–TC16: Seamless Wallet ledger, concurrency mutex, idempotency & late bet
│   └── 04-table-and-rtp.spec.ts# TC17–TC20: Table UI, Bead Road, shoe cut card & 100k Monte Carlo RTP
├── dashboard/                  # Static bilingual QA dashboard + interactive test console + 100k RTP panel
├── dashboard-tests/            # 48 Playwright tests verifying the dashboard UI & mocked GitHub API
└── scripts/                    # Multi-round runner, result aggregator, CI verdict judge & static site builder
```

---

## Quick Start (Local Execution)

### 1. Install Dependencies

```bash
npm ci
npx playwright install chromium
```

### 2. Run the Full 20-Case E2E Suite

```bash
# Run against the standard compliant engine (20 passed)
npm test

# Run against the fault-injected engine (8 planted iGaming bugs intercepted)
TARGET=with-bugs npx playwright test
```

### 3. Run Multi-Round Pipeline + Verdict Judge Locally

```bash
# Run 1 round on with-bugs and verify all 8 iGaming bugs are caught (Verdict: GREEN)
TARGET=with-bugs ROUNDS=1 node scripts/run-rounds.mjs
node scripts/aggregate.mjs
node scripts/verdict.mjs
```

### 4. Start the Baccarat Casino Table UI Locally

```bash
node app/server.mjs
# Open http://127.0.0.1:4100 in your browser
```

### 5. Run Static Analysis & Dashboard Self-Tests

```bash
npm run typecheck
npm run lint
npm run check:config
npm run test:dashboard
```
