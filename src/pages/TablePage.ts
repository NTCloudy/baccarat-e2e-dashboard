import { expect, type Locator, type Page } from '@playwright/test';
import { type BetZone, type Card } from '../api/baccaratApi';
import { currentTarget } from '../support/target';

export class TablePage {
  readonly title: Locator;
  readonly targetBadge: Locator;
  readonly statusBadge: Locator;
  readonly walletBalance: Locator;
  readonly totalBet: Locator;
  readonly playerPoints: Locator;
  readonly bankerPoints: Locator;
  readonly playerCards: Locator;
  readonly bankerCards: Locator;
  readonly roundOutcome: Locator;
  readonly clearButton: Locator;
  readonly dealButton: Locator;
  readonly resetButton: Locator;
  readonly messageBanner: Locator;
  readonly beadItems: Locator;
  readonly ledgerRows: Locator;

  constructor(
    readonly page: Page,
    readonly sessionId: string,
  ) {
    this.title = page.getByTestId('table-title');
    this.targetBadge = page.getByTestId('target-mode');
    this.statusBadge = page.getByTestId('table-status');
    this.walletBalance = page.getByTestId('wallet-balance');
    this.totalBet = page.getByTestId('total-bet');
    this.playerPoints = page.getByTestId('player-points');
    this.bankerPoints = page.getByTestId('banker-points');
    this.playerCards = page.getByTestId('player-cards').getByTestId('card-item');
    this.bankerCards = page.getByTestId('banker-cards').getByTestId('card-item');
    this.roundOutcome = page.getByTestId('round-outcome');
    this.clearButton = page.getByTestId('btn-clear');
    this.dealButton = page.getByTestId('btn-deal');
    this.resetButton = page.getByTestId('btn-reset');
    this.messageBanner = page.getByTestId('table-message');
    this.beadItems = page.getByTestId('bead-road').getByTestId('bead-item');
    this.ledgerRows = page.getByTestId('ledger-rows').getByTestId('ledger-row');
  }

  async open(): Promise<void> {
    const mode = currentTarget();
    await this.page.goto(`/?session=${encodeURIComponent(this.sessionId)}&mode=${encodeURIComponent(mode)}`);
    await this.verifyLoaded();
  }

  async sync(): Promise<void> {
    if (this.page.url() === 'about:blank') {
      await this.open();
      return;
    }
    await this.page.evaluate(async () => {
      const win = window as unknown as { refreshTableState?: () => Promise<void> };
      if (win.refreshTableState) await win.refreshTableState();
    });
  }

  async verifyLoaded(): Promise<void> {
    await expect(this.title).toHaveText('Royal Punto Banco · 8-Deck Baccarat');
    await expect(this.walletBalance).toBeVisible();
    await expect(this.dealButton).toBeEnabled();
  }

  chip(denomination: 10 | 25 | 100 | 500): Locator {
    return this.page.getByTestId(`chip-${denomination}`);
  }

  betZone(zone: BetZone): Locator {
    return this.page.getByTestId(`bet-zone-${zone}`);
  }

  betAmount(zone: BetZone): Locator {
    return this.page.getByTestId(`bet-amount-${zone}`);
  }

  async selectChip(denomination: 10 | 25 | 100 | 500): Promise<void> {
    await this.chip(denomination).click();
    await expect(this.chip(denomination)).toHaveClass(/active/);
  }

  async clickBetZone(zone: BetZone): Promise<void> {
    await this.betZone(zone).click();
  }

  async clearBets(): Promise<void> {
    await this.clearButton.click();
  }

  async setTestDeck(deck: Card[]): Promise<void> {
    await this.page.evaluate((cards) => {
      (window as unknown as { __TEST_DECK__?: Card[] }).__TEST_DECK__ = cards;
    }, deck);
  }

  async dealHand(deck?: Card[]): Promise<void> {
    if (deck) await this.setTestDeck(deck);
    await this.dealButton.click();
  }

  async verifyBalance(expectedDollars: number): Promise<void> {
    const formatted = `${expectedDollars < 0 ? '-' : ''}$${Math.abs(expectedDollars).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    await expect(this.walletBalance).toHaveText(formatted);
  }
}
