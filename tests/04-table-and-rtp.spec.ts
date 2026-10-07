import { cards } from '../src/api/baccaratApi';
import { expect, test } from '../src/fixtures';

test.describe('Table & RTP', () => {
  test('TC17 Table UI chip selection, multi-zone betting, and Clear Bets refund', async ({ tablePage }) => {
    await test.step('Open the Baccarat table UI and select the $100 chip', async () => {
      await tablePage.open();
      await tablePage.verifyBalance(1000);
      await tablePage.selectChip(100);
    });

    await test.step('Click Player and Tie bet zones; select $25 chip and click Banker Pair', async () => {
      await tablePage.clickBetZone('player');
      await tablePage.clickBetZone('tie');
      await tablePage.selectChip(25);
      await tablePage.clickBetZone('bankerPair');

      await expect(tablePage.betAmount('player')).toHaveText('$100.00');
      await expect(tablePage.betAmount('tie')).toHaveText('$100.00');
      await expect(tablePage.betAmount('bankerPair')).toHaveText('$25.00');
      await expect(tablePage.totalBet).toHaveText('$225.00');
      await tablePage.verifyBalance(775);
    });

    await test.step('Click Clear Bets: all active stakes reset to $0.00 and wallet returns to $1,000.00', async () => {
      await tablePage.clearBets();
      await expect(tablePage.totalBet).toHaveText('$0.00');
      await expect(tablePage.betAmount('player')).toHaveText('$0.00');
      await tablePage.verifyBalance(1000);
    });
  });

  test('TC18 Table UI deal updates cards, balance, Bead Road, and ledger', async ({ tablePage }) => {
    await test.step('Open table UI, select $100 chip, and bet on Player', async () => {
      await tablePage.open();
      await tablePage.selectChip(100);
      await tablePage.clickBetZone('player');
      await tablePage.verifyBalance(900);
    });

    await test.step('Deal a Player Natural 9 (♠5+♥4 vs ♦3+♣3): UI shows cards, points, Bead Road, and $1,100.00 balance', async () => {
      await tablePage.dealHand(cards('S5', 'D3', 'H4', 'C3', 'S10', 'H10'));
      await expect(tablePage.playerPoints).toHaveText('9');
      await expect(tablePage.bankerPoints).toHaveText('6');
      await expect(tablePage.playerCards).toHaveCount(2);
      await expect(tablePage.bankerCards).toHaveCount(2);
      await expect(tablePage.roundOutcome).toContainText('PLAYER WINS');
      await tablePage.verifyBalance(1100);
      await expect(tablePage.beadItems).toHaveCount(1);
      await expect(tablePage.beadItems.first()).toHaveText('P9');
      await expect(tablePage.ledgerRows).toHaveCount(3);
    });
  });

  test('TC19 Page reload recovers session wallet balance, Bead Road, and ledger', async ({ page, tablePage }) => {
    await test.step('Complete one round and place a new $50 bet on Banker for round #2', async () => {
      await tablePage.open();
      await tablePage.selectChip(100);
      await tablePage.clickBetZone('player');
      await tablePage.dealHand(cards('S5', 'D3', 'H4', 'C3', 'S10', 'H10'));
      await tablePage.verifyBalance(1100);

      await tablePage.selectChip(25);
      await tablePage.clickBetZone('banker');
      await tablePage.clickBetZone('banker');
      await tablePage.verifyBalance(1050);
    });

    await test.step('Reload the page: wallet balance ($1,050.00), active Banker bet ($50.00), Bead Road, and ledger persist', async () => {
      await page.reload();
      await tablePage.verifyLoaded();
      await tablePage.verifyBalance(1050);
      await expect(tablePage.betAmount('banker')).toHaveText('$50.00');
      await expect(tablePage.totalBet).toHaveText('$50.00');
      await expect(tablePage.beadItems).toHaveCount(1);
      await expect(tablePage.beadItems.first()).toHaveText('P9');
      await expect(tablePage.ledgerRows).toHaveCount(5);
    });
  });

  test('TC20 100,000-round Monte Carlo simulation matches 8-deck theoretical RTP', async ({ api, data }) => {
    const rounds = data.number('rounds');

    await test.step(`Simulate ${rounds.toLocaleString('en-US')} hands from 8-deck shoes and verify win probabilities and RTP`, async () => {
      const report = await api.simulate(rounds, 20261007);
      const playerRtpDiff = Math.abs(report.rtp.player - report.theoretical.rtp.player);
      const bankerRtpDiff = Math.abs(report.rtp.banker - report.theoretical.rtp.banker);
      const tieProbDiff = Math.abs(report.probabilities.tie - report.theoretical.probabilities.tie);

      // For 100,000 rounds, 4-sigma tolerance on main-bet RTP is ~0.012 (1.2 percentage points).
      expect(
        {
          playerWithinTolerance: playerRtpDiff < 0.015,
          bankerWithinTolerance: bankerRtpDiff < 0.015,
          tieWithinTolerance: tieProbDiff < 0.006,
        },
        `[TC20 rtp-simulation] Observed RTP (Player ${(report.rtp.player * 100).toFixed(2)}%, Banker ${(report.rtp.banker * 100).toFixed(2)}%) must stay within 1.5% of 8-deck theoretical RTP (Player 98.76%, Banker 98.94%)`,
      ).toEqual({
        playerWithinTolerance: true,
        bankerWithinTolerance: true,
        tieWithinTolerance: true,
      });
    });
  });
});
