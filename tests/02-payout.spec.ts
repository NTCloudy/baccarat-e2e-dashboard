import { cards } from '../src/api/baccaratApi';
import { expect, test } from '../src/fixtures';

test.describe('Payout', () => {
  test('TC07 Player win pays 1 to 1 and Banker bet loses', async ({ api, data }) => {
    const amount = data.number('amount');

    await test.step(`Place $${amount} on Player and $20 on Banker`, async () => {
      await api.placeBet('player', amount);
      const state = await api.placeBet('banker', 20);
      expect(state.balance).toBe(1000 - amount - 20);
    });

    await test.step('Deal Player Natural 9 vs Banker 4: Player pays 2x stake, Banker loses', async () => {
      const res = await api.deal(cards('S5', 'D2', 'H4', 'C2', 'S10', 'H10'));
      expect(res.round.outcome).toBe('player');
      expect(res.round.settlement.totalReturn).toBe(amount * 2);
      expect(res.balance).toBe(1000 + amount - 20);
    });
  });

  test('TC08 Banker win pays 1 to 0.95 with exact 5% commission', async ({ api, data }) => {
    const amount = data.number('amount');
    const expectedProfit = Number(((amount * 95) / 100).toFixed(2));
    const expectedPayout = Number((amount + expectedProfit).toFixed(2));
    const expectedBalance = Number((1000 + expectedProfit).toFixed(2));

    await test.step(`Place $${amount} on Banker`, async () => {
      const state = await api.placeBet('banker', amount);
      expect(state.balance).toBe(1000 - amount);
    });

    await test.step(`Deal Banker Natural 9: payout must be exact $${expectedPayout} (5% commission to the cent)`, async () => {
      const res = await api.deal(cards('S2', 'D5', 'H2', 'C4', 'S10', 'H10'));
      expect(res.round.outcome).toBe('banker');
      expect(
        res.round.settlement.totalReturn,
        `[TC08 banker-commission] Banker win on $${amount} must return $${expectedPayout} (1:0.95 exact cents, no floor truncation)`,
      ).toBe(expectedPayout);
      expect(res.balance).toBe(expectedBalance);
    });
  });

  test('TC09 Tie pays 1 to 8 and pushes Player and Banker main bets', async ({ api, data }) => {
    const tieBet = data.number('tieBet');
    const mainBet = data.number('mainBet');

    await test.step(`Place $${tieBet} on Tie, $${mainBet} on Player, and $${mainBet} on Banker`, async () => {
      await api.placeBet('tie', tieBet);
      await api.placeBet('player', mainBet);
      const state = await api.placeBet('banker', mainBet);
      expect(state.balance).toBe(1000 - tieBet - mainBet * 2);
    });

    await test.step('Deal 8-8 Tie: Tie pays 9x stake and both Player and Banker main bets push (refund)', async () => {
      const res = await api.deal(cards('S5', 'D5', 'H3', 'C3', 'S10', 'H10'));
      expect(res.round.outcome).toBe('tie');
      const expectedReturn = tieBet * 9 + mainBet * 2;
      expect(
        res.round.settlement.totalReturn,
        `[TC09 tie-push] On a Tie, Player ($${mainBet}) and Banker ($${mainBet}) main bets must push (refund) alongside the 1:8 Tie payout`,
      ).toBe(expectedReturn);
      expect(res.balance).toBe(1000 + tieBet * 8);
    });
  });

  test('TC10 Player Pair and Banker Pair pay 1 to 11 on any suit combination', async ({ api, data }) => {
    const amount = data.number('amount');

    await test.step(`Place $${amount} on Player Pair and $${amount} on Banker Pair`, async () => {
      await api.placeBet('playerPair', amount);
      await api.placeBet('bankerPair', amount);
    });

    await test.step('Deal mixed-suit pairs (Player ♠K+♥K, Banker ♦7+♣7): both Pair side-bets must win 1:11', async () => {
      const res = await api.deal(cards('SK', 'D7', 'HK', 'C7', 'S9', 'H10'));
      expect(
        res.round.playerPair && res.round.bankerPair,
        '[TC10 mixed-suit-pair] Same-rank initial cards of different suits (♠K+♥K and ♦7+♣7) must count as Pairs',
      ).toBe(true);
      expect(res.round.settlement.totalReturn).toBe(amount * 12 * 2);
      expect(res.balance).toBe(1000 + amount * 11 * 2);
    });
  });

  test('TC11 Combined multi-zone bets settle main and side bets independently', async ({ api }) => {
    await test.step('Place wagers across all 5 bet zones ($100 Player, $100 Banker, $20 Tie, $25 Player Pair, $25 Banker Pair)', async () => {
      await api.placeBet('player', 100);
      await api.placeBet('banker', 100);
      await api.placeBet('tie', 20);
      await api.placeBet('playerPair', 25);
      const state = await api.placeBet('bankerPair', 25);
      expect(state.balance).toBe(730);
    });

    await test.step('Deal Player Pair (♠4+♠4 = 8 Natural) vs Banker (♦5+♣2 = 7): Player (1:1) and Player Pair (1:11) win', async () => {
      const res = await api.deal(cards('S4', 'D5', 'S4', 'C2', 'S10', 'H10'));
      expect(res.round.outcome).toBe('player');
      expect(res.round.playerPair).toBe(true);
      expect(res.round.bankerPair).toBe(false);
      // Player returns $200, Player Pair returns $25 * 12 = $300; total return = $500
      expect(res.round.settlement.totalReturn).toBe(500);
      expect(res.balance).toBe(1230);
    });
  });
});
