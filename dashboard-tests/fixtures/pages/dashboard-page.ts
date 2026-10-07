import { expect, type Locator, type Page } from '@playwright/test';
import type { Language } from '../site';

/**
 * What every view of the dashboard shares: the header (run button with its
 * "running" badge, share button, language switch) and the main area.
 * Locators use ids and data attributes, so they work in every language;
 * tests assert the visible texts.
 */
export class DashboardPage {
  readonly header: Locator;
  /** "▶ Run tests" in the header; it carries the running badge. */
  readonly runTestsButton: Locator;
  readonly runningBadge: Locator;
  readonly shareButton: Locator;
  readonly main: Locator;

  constructor(readonly page: Page) {
    this.header = page.locator('#header');
    this.runTestsButton = this.header.locator('a[href="#/console"]');
    this.runningBadge = page.locator('#run-indicator');
    this.shareButton = page.locator('#share-btn');
    this.main = page.locator('#app');
  }

  /** Opens a route such as "/", "/console/TC04" or "/run/123"; `lang` adds ?lang= like a shared link. */
  async open(route: string, { lang }: { lang?: Language } = {}): Promise<void> {
    await this.page.goto(`/${lang ? `?lang=${lang}` : ''}#${route}`);
  }

  languageButton(lang: Language): Locator {
    return this.header.locator(`[data-lang="${lang}"]`);
  }

  async switchLanguage(lang: Language): Promise<void> {
    await this.languageButton(lang).click();
    await expect(this.page.locator('html')).toHaveAttribute('lang', lang);
  }
}
