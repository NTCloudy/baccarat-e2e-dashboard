import type { Locator, Page } from '@playwright/test';
import type { Language } from '../site';

type Field = 'title' | 'description';

/** The title and description editor of one case in the console. */
export class DescriptionEditor {
  readonly form: Locator;
  readonly heading: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  /** The save error (conflict, missing permission, ...). */
  readonly error: Locator;

  constructor(
    page: Page,
    readonly caseId: string,
  ) {
    this.form = page.locator(`[data-desc-form="${caseId}"]`);
    this.heading = this.form.locator('.desc-editor-head strong');
    this.saveButton = this.form.locator('[data-desc-save]');
    this.cancelButton = this.form.locator('[data-act="edit-cancel"]');
    this.error = this.form.locator('[data-desc-error]');
  }

  field(field: Field, lang: Language): Locator {
    return this.form.locator(`#desc-${this.caseId}-${field}-${lang}`);
  }

  title(lang: Language): Locator {
    return this.field('title', lang);
  }

  description(lang: Language): Locator {
    return this.field('description', lang);
  }

  fieldError(field: Field, lang: Language): Locator {
    return this.form.locator(`#desc-${this.caseId}-${field}-${lang}-error`);
  }

  /** "123 / 500" under a description. */
  counter(lang: Language): Locator {
    return this.form.locator(`#desc-${this.caseId}-description-${lang}-count`);
  }

  preview(lang: Language): Locator {
    return this.form.locator(`[data-preview="${lang}"]`);
  }

  /** The button that inserts "{key}" at the cursor. */
  chip(key: string): Locator {
    return this.form.locator(`[data-act="insert-ph"][data-ph="${key}"]`);
  }
}
