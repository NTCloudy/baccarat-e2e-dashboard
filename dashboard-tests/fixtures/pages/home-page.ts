import type { Locator, Page } from '@playwright/test';
import type { Language } from '../site';
import { DashboardPage } from './dashboard-page';

/** The run history (#/): KPI cards, pass-rate trend, run table, running banner. */
export class HomePage extends DashboardPage {
  readonly heading: Locator;
  readonly runRows: Locator;
  readonly trendBars: Locator;
  readonly trendHint: Locator;
  readonly runningBanner: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.main.getByRole('heading', { level: 1 });
    this.runRows = this.main.locator('.runs-table tbody tr');
    this.trendBars = this.main.locator('.trend .bar');
    this.trendHint = this.main.locator('section.card', { has: page.locator('.trend') }).locator('.section-head .muted');
    this.runningBanner = this.main.locator('.running-banner');
    this.emptyState = this.main.locator('section.empty');
  }

  async goto(options: { lang?: Language } = {}): Promise<void> {
    await this.open('/', options);
  }

  /** The table row of a run, by its label ("執行 #3", "Local run"). */
  runRow(label: string): Locator {
    return this.runRows.filter({ has: this.page.getByRole('link', { name: label, exact: true }) });
  }

  /** A KPI card by its label ("最近一次通過率"). */
  kpi(label: string): Locator {
    return this.main.locator('.kpi').filter({ has: this.page.locator('.kpi-label').getByText(label, { exact: true }) });
  }
}
