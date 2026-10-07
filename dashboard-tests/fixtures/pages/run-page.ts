import type { Locator, Page } from '@playwright/test';
import type { Language } from '../site';
import { DashboardPage } from './dashboard-page';

/** The dialog that opens from a matrix cell: one case in one round. */
export class CaseDetailDialog {
  readonly root: Locator;
  /** "TC04 · 搜尋" */
  readonly caption: Locator;
  readonly title: Locator;
  /** "第 1 輪 · ✓ 通過 · 3.1 秒" */
  readonly summary: Locator;
  readonly status: Locator;
  readonly description: Locator;
  readonly testData: Locator;
  readonly note: Locator;
  readonly error: Locator;
  readonly screenshot: Locator;
  readonly reportLink: Locator;
  readonly consoleLink: Locator;
  readonly closeButton: Locator;

  constructor(page: Page) {
    this.root = page.locator('#detail');
    const head = this.root.locator('.dialog-head > div');
    this.caption = head.locator('.muted');
    this.title = head.locator('h3');
    this.summary = head.locator('h3 + div');
    this.status = head.locator('.status');
    this.description = this.root.locator('section > p');
    this.testData = this.root.locator('dl.data-list > div');
    this.note = this.root.locator('.dialog-inner > p.muted');
    this.error = this.root.locator('pre.error');
    this.screenshot = this.root.locator('img.shot');
    this.reportLink = this.root.locator('.dialog-actions a.btn-primary');
    this.consoleLink = this.root.locator('.dialog-actions a[href^="#/console/"]');
    this.closeButton = this.root.locator('.btn-close');
  }

  /** The value of one "test data used" row, by its label ("關鍵字"). */
  testDataValue(label: string): Locator {
    return this.testData.filter({ has: this.root.page().locator('dt').getByText(label, { exact: true }) }).locator('dd');
  }
}

/** One run (#/run/<id>): meta data, round cards and the case × round matrix. */
export class RunPage extends DashboardPage {
  readonly heading: Locator;
  readonly backLink: Locator;
  readonly score: Locator;
  readonly scoreDetails: Locator;
  readonly roundCards: Locator;
  readonly matrixHeader: Locator;
  readonly moduleRows: Locator;
  readonly caseRows: Locator;
  readonly notice: Locator;
  readonly detail: CaseDetailDialog;

  constructor(page: Page) {
    super(page);
    this.heading = this.main.getByRole('heading', { level: 1 });
    this.backLink = this.main.locator('a.back');
    this.score = this.main.locator('.run-head .score-value');
    this.scoreDetails = this.main.locator('.run-head .score-sub');
    this.roundCards = this.main.locator('.round-card');
    this.matrixHeader = this.main.locator('table.matrix thead th');
    this.moduleRows = this.main.locator('table.matrix tr.module-row');
    this.caseRows = this.main.locator('table.matrix tbody tr:not(.module-row)');
    this.notice = this.main.locator('section.empty');
    this.detail = new CaseDetailDialog(page);
  }

  async goto(id: string, options: { lang?: Language } = {}): Promise<void> {
    await this.open(`/run/${encodeURIComponent(id)}`, options);
  }

  /** A meta value by its label ("測試案例"). */
  meta(label: string): Locator {
    return this.main.locator('dl.meta > div').filter({ has: this.page.locator('dt').getByText(label, { exact: true }) }).locator('dd');
  }

  caseRow(id: string): Locator {
    return this.caseRows.filter({ has: this.page.locator('.case-id').getByText(id, { exact: true }) });
  }

  /** The result cell of a case in a round (a button when the case ran in that round). */
  cell(id: string, round: number): Locator {
    return this.caseRow(id).locator('td').nth(round - 1).locator('.cell');
  }

  async openCell(id: string, round: number): Promise<void> {
    await this.cell(id, round).click();
  }
}
