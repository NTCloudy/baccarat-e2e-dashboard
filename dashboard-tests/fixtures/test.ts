import { test as base, expect } from '@playwright/test';
import { FakeClock } from './clock';
import { GitHubMock } from './github-mock';
import { BugsPage } from './pages/bugs-page';
import { ConsolePage } from './pages/console-page';
import { HomePage } from './pages/home-page';
import { RunPage } from './pages/run-page';
import { SiteData } from './results';
import { BrowserStorage } from './storage';

/**
 * `test` for the dashboard tests (dashboard-tests/*.spec.ts).
 *
 * Every test automatically gets:
 * - `clock`: the page's clock paused at FIXED_NOW; time only moves when the
 *   test advances it, so polling, elapsed times and expiry dates are deterministic;
 * - `github`: a fake api.github.com (state + request log, see GitHubMock);
 * - a network guard: any request to another host than the test site that is
 *   not mocked is aborted and fails the test, so no test reaches the network;
 * - a page error guard: an uncaught exception in the page fails the test.
 *
 * Helpers: `storage` prepares browser storage before the first page load
 * (signed in, remembered draft, followed run, language); `siteData` changes
 * what the site serves under data/ (e.g. a run published during the test);
 * `home`, `runPage`, `consolePage` and `bugsPage` are the page objects.
 */
export interface DashboardFixtures {
  clock: FakeClock;
  github: GitHubMock;
  storage: BrowserStorage;
  siteData: SiteData;
  home: HomePage;
  runPage: RunPage;
  consolePage: ConsolePage;
  bugsPage: BugsPage;
}

interface Guards {
  /** Requests that tried to leave the test site (they are aborted). */
  networkGuard: string[];
  /** Uncaught exceptions of the page. */
  pageErrors: Error[];
}

export const test = base.extend<DashboardFixtures & Guards>({
  networkGuard: [
    async ({ context, baseURL }, use) => {
      const site = new URL(baseURL ?? 'http://localhost/').origin;
      const blocked: string[] = [];
      await context.route('**/*', async (route) => {
        const request = route.request();
        if (new URL(request.url()).origin === site) return route.continue();
        blocked.push(`${request.method()} ${request.url()}`);
        return route.abort('blockedbyclient');
      });
      await use(blocked);
      if (blocked.length) throw new Error(`The page tried to reach hosts other than the test site:\n${blocked.join('\n')}`);
    },
    { auto: true },
  ],

  pageErrors: [
    async ({ page }, use) => {
      const errors: Error[] = [];
      page.on('pageerror', (error) => errors.push(error));
      await use(errors);
      if (errors.length) throw new Error(`Uncaught errors in the page:\n${errors.map((e) => e.stack ?? e.message).join('\n')}`);
    },
    { auto: true },
  ],

  clock: [
    async ({ page }, use) => {
      const clock = new FakeClock(page);
      await clock.install();
      await use(clock);
    },
    { auto: true },
  ],

  github: [
    async ({ context, clock, networkGuard }, use) => {
      // Depends on the guard so that its catch-all route exists first: the route added last wins.
      void networkGuard;
      const github = new GitHubMock(() => clock.now());
      await github.install(context);
      await use(github);
      github.close();
      github.verifyNoUnknownCalls();
    },
    { auto: true },
  ],

  storage: async ({ page }, use) => {
    await use(new BrowserStorage(page));
  },

  siteData: async ({ page }, use) => {
    await use(new SiteData(page));
  },

  home: async ({ page }, use) => {
    await use(new HomePage(page));
  },

  runPage: async ({ page }, use) => {
    await use(new RunPage(page));
  },

  consolePage: async ({ page }, use) => {
    await use(new ConsolePage(page));
  },

  bugsPage: async ({ page }, use) => {
    await use(new BugsPage(page));
  },
});

export { expect };
