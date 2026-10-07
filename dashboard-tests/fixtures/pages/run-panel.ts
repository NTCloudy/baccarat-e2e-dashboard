import { expect, type Locator, type Page } from '@playwright/test';

/** The console's progress phases of a run; "queued" means none has started. */
export type Phase = 'queued' | 'setup' | 'tests' | 'publish' | 'deploy';
const PHASES = ['setup', 'tests', 'publish', 'deploy'] as const;

/** The panel at the top of the console that follows the run started from this browser. */
export class RunPanel {
  readonly root: Locator;
  /** "執行 #4 · 執行中", "執行 #4 · 完成", ... */
  readonly heading: Locator;
  /** "已經過 2 分 5 秒 · 預計約 3 分鐘" */
  readonly timing: Locator;
  readonly elapsed: Locator;
  readonly phases: Locator;
  /** The text under the heading: the scope while running, then the outcome or "publishing the results". */
  readonly message: Locator;
  /** A GitHub error met while following the run. */
  readonly warning: Locator;
  readonly passRate: Locator;
  readonly resultCounts: Locator;
  readonly chips: Locator;
  readonly viewResultsLink: Locator;
  readonly logLink: Locator;
  readonly cancelButton: Locator;
  readonly dismissButton: Locator;

  constructor(page: Page) {
    this.root = page.locator('#run-panel > section.run-panel');
    this.heading = this.root.locator('.run-panel-head h2');
    this.timing = this.root.locator('.run-panel-head > span.muted');
    this.elapsed = this.root.locator('[data-elapsed]');
    this.phases = this.root.locator('.phases .phase');
    this.message = this.root.locator(':scope > p');
    this.warning = this.root.locator('p.param-warn');
    this.passRate = this.root.locator('.run-result .score-value');
    this.resultCounts = this.root.locator('.run-result .score-value + div > div').first();
    this.chips = this.root.locator('.result-chips .chip');
    this.viewResultsLink = this.root.locator('a.btn-primary[href^="#/run/"]');
    this.logLink = this.root.locator('a[href*="/actions/runs/"]');
    this.cancelButton = this.root.locator('[data-act="run-cancel"]');
    this.dismissButton = this.root.locator('[data-act="run-dismiss"]');
  }

  /** Checks the phase list: earlier phases done, `current` active, later ones pending. */
  async expectPhase(current: Phase, options: { timeout?: number } = {}): Promise<void> {
    const index = current === 'queued' ? -1 : PHASES.indexOf(current);
    const classes = PHASES.map((_, i) => (i < index ? /phase-done/ : i === index ? /phase-active/ : /phase-pending/));
    await expect(this.phases).toHaveClass(classes, options);
  }

  /** The chip of a case in the published result. */
  chip(caseId: string): Locator {
    return this.chips.filter({ has: this.root.page().locator('.case-id').getByText(caseId, { exact: true }) });
  }
}
