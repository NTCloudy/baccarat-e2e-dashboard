import { cards } from '../src/api/baccaratApi';
import { expect, test } from '../src/fixtures';

test.describe('Tableau', () => {
  test('TC01 Natural 8 or 9 stands immediately', async ({ api }) => {
    await test.step('Player Natural 9 (♠5 + ♥4) vs Banker 4 (♦2 + ♣2): neither side draws a 3rd card', async () => {
      const { round } = await api.deal(cards('S5', 'D2', 'H4', 'C2', 'S3', 'H7'));
      expect(round.natural, 'hand is flagged as Natural').toBe(true);
      expect(round.playerCards).toHaveLength(2);
      expect(round.bankerCards).toHaveLength(2);
      expect(round.playerPoints).toBe(9);
      expect(round.bankerPoints).toBe(4);
      expect(round.outcome).toBe('player');
    });

    await test.step('Banker Natural 8 (♦5 + ♣3) vs Player 5 (♠2 + ♥3): neither side draws a 3rd card', async () => {
      const { round } = await api.deal(cards('S2', 'D5', 'H3', 'C3', 'S4', 'H9'));
      expect(round.natural, 'hand is flagged as Natural').toBe(true);
      expect(round.playerCards).toHaveLength(2);
      expect(round.bankerCards).toHaveLength(2);
      expect(round.playerPoints).toBe(5);
      expect(round.bankerPoints).toBe(8);
      expect(round.outcome).toBe('banker');
    });
  });

  test('TC02 Player draws on 0 to 5 and stands on 6 to 7', async ({ api }) => {
    await test.step('Player initial 5 (♠2 + ♥3) vs Banker 7 (♦4 + ♣3): Player draws a 3rd card', async () => {
      const { round } = await api.deal(cards('S2', 'D4', 'H3', 'C3', 'S4', 'H9'));
      expect(round.playerInitial).toBe(5);
      expect(round.playerCards).toHaveLength(3);
      expect(round.playerPoints).toBe(9);
      expect(round.bankerCards).toHaveLength(2);
      expect(round.outcome).toBe('player');
    });

    await test.step('Player initial 6 (♠3 + ♥3) vs Banker 7 (♦4 + ♣3): Player stands on 6', async () => {
      const { round } = await api.deal(cards('S3', 'D4', 'H3', 'C3', 'S2', 'H9'));
      expect(round.playerInitial).toBe(6);
      expect(round.playerCards).toHaveLength(2);
      expect(round.bankerCards).toHaveLength(2);
      expect(round.outcome).toBe('banker');
    });
  });

  test('TC03 Banker draws on 0 to 5 and stands on 6 to 7 when Player stands', async ({ api }) => {
    await test.step('Player stands on 6 (♠3 + ♥3), Banker initial 5 (♦2 + ♣3): Banker draws a 3rd card', async () => {
      const { round } = await api.deal(cards('S3', 'D2', 'H3', 'C3', 'S4', 'H9'));
      expect(round.playerCards).toHaveLength(2);
      expect(round.bankerInitial).toBe(5);
      expect(round.bankerCards).toHaveLength(3);
      expect(round.bankerPoints).toBe(9);
      expect(round.outcome).toBe('banker');
    });

    await test.step('Player stands on 7 (♠4 + ♥3), Banker initial 6 (♦3 + ♣3): Banker stands on 6', async () => {
      const { round } = await api.deal(cards('S4', 'D3', 'H3', 'C3', 'S3', 'H9'));
      expect(round.playerCards).toHaveLength(2);
      expect(round.bankerInitial).toBe(6);
      expect(round.bankerCards).toHaveLength(2);
      expect(round.outcome).toBe('player');
    });
  });

  test('TC04 Banker 3 stands against Player third card 8 and draws otherwise', async ({ api }) => {
    await test.step('Banker 3 (♦A + ♣2) vs Player 3rd card 7: Banker draws a 3rd card', async () => {
      const { round } = await api.deal(cards('S2', 'DA', 'H2', 'C2', 'S7', 'H5'));
      expect(round.bankerInitial).toBe(3);
      expect(round.playerCards).toHaveLength(3);
      expect(round.bankerCards).toHaveLength(3);
      expect(round.bankerPoints).toBe(8);
    });

    await test.step('Banker 3 (♦A + ♣2) vs Player 3rd card 8: Banker must stand at 2 cards', async () => {
      const { round } = await api.deal(cards('S2', 'DA', 'H2', 'C2', 'S8', 'H6'));
      expect(round.bankerInitial).toBe(3);
      expect(round.playerCards[2]?.rank).toBe('8');
      expect(
        round.bankerCards,
        '[TC04 banker-3-vs-8] Banker on initial 3 must stand when Player draws 8 as the third card',
      ).toHaveLength(2);
      expect(round.bankerPoints).toBe(3);
      expect(round.outcome).toBe(' banker'.trim());
    });
  });

  test('TC05 Banker 4 and 5 third-card drawing boundaries', async ({ api }) => {
    await test.step('Banker 4 stands when Player 3rd card is 1 or 8, and draws when Player 3rd card is 2..7', async () => {
      const standOn1 = await api.deal(cards('S2', 'D2', 'H2', 'C2', 'SA', 'H5'));
      expect(standOn1.round.bankerInitial).toBe(4);
      expect(standOn1.round.bankerCards).toHaveLength(2);

      const drawOn2 = await api.deal(cards('S2', 'D2', 'H2', 'C2', 'S2', 'H5'));
      expect(drawOn2.round.bankerInitial).toBe(4);
      expect(drawOn2.round.bankerCards).toHaveLength(3);

      const standOn8 = await api.deal(cards('S2', 'D2', 'H2', 'C2', 'S8', 'H5'));
      expect(standOn8.round.bankerCards).toHaveLength(2);
    });

    await test.step('Banker 5 stands when Player 3rd card is 3 or 8, and draws when Player 3rd card is 4..7', async () => {
      const standOn3 = await api.deal(cards('S2', 'D2', 'H2', 'C3', 'S3', 'H4'));
      expect(standOn3.round.bankerInitial).toBe(5);
      expect(standOn3.round.bankerCards).toHaveLength(2);

      const drawOn4 = await api.deal(cards('S2', 'D2', 'H2', 'C3', 'S4', 'H4'));
      expect(drawOn4.round.bankerInitial).toBe(5);
      expect(drawOn4.round.bankerCards).toHaveLength(3);
    });
  });

  test('TC06 Banker 6 and 7 third-card drawing boundaries', async ({ api }) => {
    await test.step('Banker 6 stands on Player 3rd card 5 and draws only on 6 or 7', async () => {
      const standOn5 = await api.deal(cards('S2', 'D3', 'H2', 'C3', 'S5', 'H3'));
      expect(standOn5.round.bankerInitial).toBe(6);
      expect(standOn5.round.bankerCards).toHaveLength(2);

      const drawOn6 = await api.deal(cards('S2', 'D3', 'H2', 'C3', 'S6', 'H3'));
      expect(drawOn6.round.bankerInitial).toBe(6);
      expect(drawOn6.round.bankerCards).toHaveLength(3);
    });

    await test.step('Banker 7 always stands regardless of Player 3rd card', async () => {
      const standOn7 = await api.deal(cards('S2', 'D4', 'H2', 'C3', 'S7', 'H2'));
      expect(standOn7.round.bankerInitial).toBe(7);
      expect(standOn7.round.bankerCards).toHaveLength(2);
    });
  });
});
