import type { Locator, Page } from '@playwright/test';

/** The "Set up a GitHub token" dialog of the console. */
export class TokenDialog {
  readonly root: Locator;
  readonly heading: Locator;
  /** The pre-filled "new fine-grained token" link on github.com. */
  readonly createTokenLink: Locator;
  readonly input: Locator;
  readonly remember: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  readonly error: Locator;

  constructor(page: Page) {
    this.root = page.locator('#token-dialog');
    this.heading = this.root.locator('h3');
    this.createTokenLink = this.root.locator('.token-steps a');
    this.input = this.root.locator('#token-input');
    this.remember = this.root.locator('#token-remember');
    this.saveButton = this.root.locator('#token-save');
    this.cancelButton = this.root.locator('.dialog-actions [data-act="token-cancel"]');
    this.error = this.root.locator('#token-error');
  }

  /** Pastes a token and presses "Save and check". */
  async submit(token: string, { remember = false }: { remember?: boolean } = {}): Promise<void> {
    await this.input.fill(token);
    await this.remember.setChecked(remember);
    await this.saveButton.click();
  }
}
