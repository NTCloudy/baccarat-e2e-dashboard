import type { Locator, Page } from '@playwright/test';
import type { Language } from '../site';
import { DashboardPage } from './dashboard-page';

/** The Bug detection page (#/bugs): verdict banner, KPI cards, official bugs, unlisted findings, case table and out-of-scope list. */
export class BugsPage extends DashboardPage {
  readonly heading: Locator;
  readonly emptyState: Locator;
  readonly verdict: Locator;
  readonly verdictTitle: Locator;
  readonly kpis: Locator;
  readonly bugTables: Locator;
  readonly caseRows: Locator;
  readonly scopeItems: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.main.getByRole('heading', { level: 1 });
    this.emptyState = this.main.locator('section.empty');
    this.verdict = this.main.locator('section.verdict');
    this.verdictTitle = this.verdict.locator('.verdict-title');
    this.kpis = this.main.locator('.bug-kpis .kpi');
    this.bugTables = this.main.locator('table.bug-table');
    this.caseRows = this.main.locator('table.case-table tbody tr');
    this.scopeItems = this.main.locator('ul.scope-list > li.scope-item');
  }

  async goto(options: { lang?: Language } = {}): Promise<void> {
    await this.open('/bugs', options);
  }

  kpi(label: string): Locator {
    return this.kpis.filter({ has: this.page.locator('.kpi-label').getByText(label, { exact: true }) });
  }

  bugRow(ref: string): Locator {
    return this.bugTables.locator('tbody tr').filter({ has: this.page.locator('.bug-id, .bug-key').getByText(ref, { exact: true }) });
  }

  caseRow(id: string): Locator {
    return this.caseRows.filter({ has: this.page.locator('.case-id').getByText(id, { exact: true }) });
  }
}
