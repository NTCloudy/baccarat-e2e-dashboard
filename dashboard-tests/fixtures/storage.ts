import type { Page } from '@playwright/test';
import { FIXED_NOW } from './clock';
import { OWNER, OWNER_TOKEN, type WorkflowRun } from './github-mock';
import { applicableCaseCount, estimateMinutes, type Language, type Target } from './site';

/** The browser storage keys of the dashboard (core.js, console.js, github.js). */
export const STORAGE_KEYS = {
  /** JSON TokenEntry: sessionStorage, or localStorage when "remember" is ticked. */
  token: 'e2e-console-token',
  /** JSON Draft (localStorage). */
  draft: 'e2e-console-draft',
  /** JSON TrackedRun (localStorage): the run started from this browser. */
  run: 'e2e-console-run',
  /** The chosen language as a plain string (localStorage). */
  language: 'e2e-dashboard-lang',
} as const;

export interface TokenEntry {
  token: string;
  login: string;
  id: number | null;
  /** The expiry GitHub reported when the token was verified, e.g. "2026-12-31 08:00:00 UTC". */
  expires: string | null;
  savedAt: string;
}

/** The console's remembered form: rounds, target, selected case ids and test data that differs from the defaults. */
export interface Draft {
  rounds: number;
  target: Target;
  selected: string[];
  values: Record<string, Record<string, string | number>>;
}

/** A run the console follows, as console.js stores it. */
export interface TrackedRun {
  id: string;
  htmlUrl: string | null;
  runNumber: number | null;
  dispatchedAt: string;
  startedAt: string | null;
  rounds: number;
  target?: Target;
  caseCount: number;
  total: number;
  customCases: number;
  estimate: number;
  status: string;
  phase: string;
  done: boolean;
  outcome?: 'published' | 'cancelled' | 'broken';
}

/** What the console stores right after it started `run` for `caseCount` cases (as if the owner had pressed "Run" earlier). */
export function trackedRun(
  run: WorkflowRun,
  { caseCount, customCases = 0, target = 'production' }: { caseCount: number; customCases?: number; target?: Target },
): TrackedRun {
  return {
    id: run.id,
    htmlUrl: run.htmlUrl,
    runNumber: null,
    dispatchedAt: run.createdAt.toISOString(),
    startedAt: null,
    rounds: run.rounds,
    target,
    caseCount,
    total: applicableCaseCount(target),
    customCases,
    estimate: estimateMinutes(caseCount, run.rounds),
    status: 'queued',
    phase: 'queued',
    done: false,
  };
}

type Area = 'local' | 'session';

/**
 * Prepares localStorage/sessionStorage before the dashboard's scripts run,
 * like a returning visitor (signed in, a remembered draft, a run in progress,
 * a chosen language). Call the seed methods before the first navigation.
 *
 * Seeds are applied once per tab: a reload keeps what the page itself stored
 * since (e.g. a run that progressed), like a real reload.
 */
export class BrowserStorage {
  private seeds = 0;

  constructor(private readonly page: Page) {}

  /** Writes raw strings into localStorage or sessionStorage before the first page load. */
  async seed(area: Area, items: Record<string, string>): Promise<void> {
    const marker = `pw-seed-${++this.seeds}`;
    await this.page.addInitScript(
      ({ area, items, marker }) => {
        try {
          if (sessionStorage.getItem(marker)) return;
          sessionStorage.setItem(marker, '1');
          const storage = area === 'local' ? localStorage : sessionStorage;
          for (const [key, value] of Object.entries(items)) storage.setItem(key, value);
        } catch {
          // Documents without storage (about:blank).
        }
      },
      { area, items, marker },
    );
  }

  /** Signs in with a verified token (by default the owner's, kept for this tab only). */
  async signIn({ remember = false, ...entry }: Partial<TokenEntry> & { remember?: boolean } = {}): Promise<TokenEntry> {
    const value: TokenEntry = { token: OWNER_TOKEN, login: OWNER.login, id: OWNER.id, expires: null, savedAt: FIXED_NOW.toISOString(), ...entry };
    await this.seed(remember ? 'local' : 'session', { [STORAGE_KEYS.token]: JSON.stringify(value) });
    return value;
  }

  /** The console's remembered form (raw: invalid values are allowed, the console has to drop them). */
  async rememberDraft(draft: Partial<Record<keyof Draft, unknown>>): Promise<void> {
    await this.seed('local', { [STORAGE_KEYS.draft]: JSON.stringify(draft) });
  }

  /** A run started from this browser that the console should keep following. */
  async followRun(run: TrackedRun): Promise<void> {
    await this.seed('local', { [STORAGE_KEYS.run]: JSON.stringify(run) });
  }

  async chooseLanguage(lang: Language): Promise<void> {
    await this.seed('local', { [STORAGE_KEYS.language]: lang });
  }

  /** Reads a JSON value the dashboard stored. */
  async read<T>(area: Area, key: string): Promise<T | null> {
    const raw = await this.page.evaluate(({ area, key }) => (area === 'local' ? localStorage : sessionStorage).getItem(key), { area, key });
    return raw === null ? null : (JSON.parse(raw) as T);
  }
}
