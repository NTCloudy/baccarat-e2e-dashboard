import { expect, test } from '../src/fixtures';

test.describe('Wallet', () => {
  test('TC12 Table minimum and maximum bet limits are enforced', async ({ api }) => {
    await test.step('Below minimum ($5 < $10 min) is rejected with BELOW_MIN_BET', async () => {
      const belowMin = await api.tryPlaceBet('player', 5);
      expect(belowMin.status).toBe(400);
      expect(belowMin.code).toBe('BELOW_MIN_BET');
    });

    await test.step('Main zone bet above $5,000 maximum is rejected with ABOVE_MAX_BET', async () => {
      await api.reset(10_000);
      const aboveMainMax = await api.tryPlaceBet('banker', 5001);
      expect(aboveMainMax.status).toBe(400);
      expect(aboveMainMax.code).toBe('ABOVE_MAX_BET');
    });

    await test.step('Side zone cumulative bet above $1,000 maximum is rejected without debiting', async () => {
      await api.placeBet('tie', 600);
      const aboveTieMax = await api.tryPlaceBet('tie', 500);
      expect(aboveTieMax.status).toBe(400);
      expect(aboveTieMax.code).toBe('ABOVE_MAX_BET');
      const state = await api.getState();
      expect(state.balance).toBe(9400);
      expect(state.bets.tie).toBe(600);
    });
  });

  test('TC13 Bet exceeding available wallet balance is rejected', async ({ api }) => {
    await test.step('Reset wallet to $150 and attempt a $200 bet', async () => {
      await api.reset(150);
      const res = await api.tryPlaceBet('player', 200);
      expect(res.status).toBe(400);
      expect(res.code).toBe('INSUFFICIENT_BALANCE');
    });

    await test.step('Wallet balance remains $150 and no DEBIT entry was added', async () => {
      const state = await api.getState();
      expect(state.balance).toBe(150);
      expect(state.totalBet).toBe(0);
      expect(state.ledger).toHaveLength(1);
    });
  });

  test('TC14 Concurrent all-in bets prevent race-condition overdraft', async ({ api, data }) => {
    const concurrency = data.number('concurrency');

    await test.step('Reset wallet balance to $200 (enough for exactly one $200 bet)', async () => {
      await api.reset(200);
    });

    await test.step(`Fire ${concurrency} simultaneous $200 bets via Promise.all: only 1 may succeed`, async () => {
      const responses = await Promise.all(
        Array.from({ length: concurrency }, () => api.tryPlaceBet('player', 200)),
      );
      const succeeded = responses.filter((r) => r.ok).length;
      const state = await api.getState();

      expect(
        { succeeded, balance: state.balance },
        `[TC14 race-condition] Concurrent all-in requests must be serialized so only 1 succeeds and balance is $0 (never negative)`,
      ).toEqual({ succeeded: 1, balance: 0 });
    });
  });

  test('TC15 Duplicate bet with the same idempotencyKey is deduplicated', async ({ api, data }) => {
    const amount = data.number('amount');
    const key = `idem-${Date.now()}`;

    await test.step(`Send 3 bet requests of $${amount} with idempotencyKey "${key}"`, async () => {
      const first = await api.placeBet('banker', amount, key);
      const second = await api.placeBet('banker', amount, key);
      const third = await api.placeBet('banker', amount, key);

      expect(
        {
          balance: third.balance,
          bankerStake: third.bets.banker,
          sameTxId: first.transactionId === second.transactionId && second.transactionId === third.transactionId,
        },
        `[TC15 idempotency] Retries with the same idempotencyKey must debit $${amount} only once and return the original transactionId`,
      ).toEqual({
        balance: 1000 - amount,
        bankerStake: amount,
        sameTxId: true,
      });
    });
  });

  test('TC16 Late bet after BETTING_CLOSED is rejected and ledger reconciles', async ({ api }) => {
    await test.step('Place a valid $100 bet while BETTING_OPEN, then close betting', async () => {
      await api.placeBet('player', 100);
      const state = await api.setTableState('BETTING_CLOSED');
      expect(state.tableState).toBe('BETTING_CLOSED');
    });

    await test.step('Attempt to place a $50 bet while BETTING_CLOSED: must be rejected with HTTP 409', async () => {
      const late = await api.tryPlaceBet('banker', 50);
      expect(
        late.status,
        '[TC16 late-bet] Bets sent after BETTING_CLOSED must be rejected with HTTP 409 Conflict',
      ).toBe(409);
    });

    await test.step('Every ledger transaction reconciles (beforeBalance + delta === afterBalance)', async () => {
      const state = await api.getState();
      expect(state.balance).toBe(900);
      const mismatches = state.ledger.filter(
        (tx) => tx.beforeCents + tx.deltaCents !== tx.afterCents,
      );
      expect(mismatches).toEqual([]);
    });
  });
});
