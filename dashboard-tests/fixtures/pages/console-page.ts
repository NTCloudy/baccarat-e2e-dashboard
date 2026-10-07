import { expect, type Locator, type Page } from '@playwright/test';
import type { Language, Target } from '../site';
import { DashboardPage } from './dashboard-page';
import { DescriptionEditor } from './description-editor';
import { RunPanel } from './run-panel';
import { TokenDialog } from './token-dialog';

/** The test console (#/console): case selection, test data, token, run bar and run panel. */
export class ConsolePage extends DashboardPage {
  readonly root: Locator;
  readonly heading: Locator;
  readonly caseItems: Locator;
  readonly target: Locator;
  readonly targetNote: Locator;
  readonly rounds: Locator;
  readonly selectAllButton: Locator;
  readonly selectNoneButton: Locator;
  readonly resetAllButton: Locator;
  readonly tokenLine: Locator;
  /** The bar at the bottom: selection summary, or what blocks the run. */
  readonly summary: Locator;
  readonly runButton: Locator;
  readonly runPanel: RunPanel;
  readonly tokenDialog: TokenDialog;

  constructor(page: Page) {
    super(page);
    this.root = page.locator('#console-root');
    this.heading = this.root.getByRole('heading', { level: 1 });
    this.caseItems = this.root.locator('[data-case-item]');
    this.target = page.locator('#c-target');
    this.targetNote = page.locator('#target-note');
    this.rounds = page.locator('#c-rounds');
    this.selectAllButton = this.root.locator('[data-act="select-all"]');
    this.selectNoneButton = this.root.locator('[data-act="select-none"]');
    this.resetAllButton = this.root.locator('[data-act="reset-all"]');
    this.tokenLine = page.locator('#token-line');
    this.summary = page.locator('#c-summary');
    this.runButton = page.locator('#c-run');
    this.runPanel = new RunPanel(page);
    this.tokenDialog = new TokenDialog(page);
  }

  /** Opens the console; with `caseId`, the #/console/TC04 deep link that opens that case. */
  async goto({ caseId, lang }: { caseId?: string; lang?: Language } = {}): Promise<void> {
    await this.open(caseId ? `/console/${caseId}` : '/console', { lang });
    await expect(this.caseItems.first()).toBeVisible();
  }

  // ---------------------------------------------------------------- cases

  caseItem(id: string): Locator {
    return this.root.locator(`[data-case-item="${id}"]`);
  }

  caseCheckbox(id: string): Locator {
    return this.root.locator(`input[data-act="toggle-case"][data-case="${id}"]`);
  }

  caseName(id: string): Locator {
    return this.root.locator(`[data-case-name="${id}"]`);
  }

  moduleCheckbox(module: string): Locator {
    return this.root.locator(`input[data-act="toggle-module"][data-module="${module}"]`);
  }

  /** "已選 1 / 5" next to a module. */
  moduleCount(module: string): Locator {
    return this.root.locator(`[data-module-count="${module}"]`);
  }

  moduleNames(): Locator {
    return this.root.locator('.module-name');
  }

  customTag(id: string): Locator {
    return this.root.locator(`[data-custom-tag="${id}"]`);
  }

  targetOnlyTag(id: string): Locator {
    return this.root.locator(`#target-tag-${id}`);
  }

  errorTag(id: string): Locator {
    return this.root.locator(`[data-error-tag="${id}"]`);
  }

  expandButton(id: string): Locator {
    return this.root.locator(`button[data-act="expand"][data-case="${id}"]`);
  }

  caseBody(id: string): Locator {
    return this.root.locator(`#case-body-${id}`);
  }

  /** The case's description with its test data filled in. */
  description(id: string): Locator {
    return this.root.locator(`[data-checks="${id}"]`);
  }

  async expand(id: string): Promise<void> {
    await this.expandButton(id).click();
    await expect(this.caseBody(id)).toBeVisible();
  }

  /** Unticks every case, then ticks `ids`. */
  async selectOnly(ids: string[]): Promise<void> {
    await this.selectNoneButton.click();
    for (const id of ids) await this.caseCheckbox(id).check();
  }

  async setRounds(rounds: number): Promise<void> {
    await this.rounds.selectOption(String(rounds));
  }

  async setTarget(target: Target): Promise<void> {
    await this.target.selectOption(target);
  }

  // ---------------------------------------------------------------- test data

  /** The input of a test data parameter. */
  param(id: string, key: string): Locator {
    return this.root.locator(`#p-${id}-${key}`);
  }

  paramError(id: string, key: string): Locator {
    return this.root.locator(`#p-${id}-${key}-error`);
  }

  paramWarning(id: string, key: string): Locator {
    return this.root.locator(`#p-${id}-${key}-warn`);
  }

  resetParamButton(id: string, key: string): Locator {
    return this.root.locator(`[data-act="reset-param"][data-case="${id}"][data-key="${key}"]`);
  }

  resetCaseButton(id: string): Locator {
    return this.root.locator(`[data-act="reset-case"][data-case="${id}"]`);
  }

  /** Types a value (the console checks it on every keystroke). */
  async setParam(id: string, key: string, value: string): Promise<void> {
    await this.param(id, key).fill(value);
  }

  /** Types a value and leaves the field (the console then fixes the letter case of known product names). */
  async enterParam(id: string, key: string, value: string): Promise<void> {
    await this.param(id, key).fill(value);
    await this.param(id, key).blur();
  }

  // ---------------------------------------------------------------- descriptions

  editButton(id: string): Locator {
    return this.root.locator(`[data-act="edit-desc"][data-case="${id}"]`);
  }

  editor(id: string): DescriptionEditor {
    return new DescriptionEditor(this.page, id);
  }

  /** Expands the case (if needed) and opens its title and description editor. */
  async openEditor(id: string): Promise<DescriptionEditor> {
    if (await this.caseBody(id).isHidden()) await this.expand(id);
    await this.editButton(id).click();
    const editor = this.editor(id);
    await expect(editor.form).toBeVisible();
    return editor;
  }

  /** "✓ Saved…" under a description after a save. */
  saveNotice(id: string): Locator {
    return this.root.locator(`[data-desc-slot="${id}"] .save-notice`);
  }
}
