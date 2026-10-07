import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { applicableCaseCount, ROOT, SITE, siteCatalog, type Target } from './site';

/**
 * The run history of the fixture site (dashboard-tests/fixtures/data/results,
 * same format as the "results" branch: runs.json + runs/<id>/summary.json)
 * and helpers to publish more runs while a test runs.
 */

export type ResultStatus = 'passed' | 'failed' | 'skipped';

export interface Totals {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  /** passed / (passed + failed); null when nothing was executed. */
  passRate: number | null;
}

/** One entry of data/runs.json. */
export interface RunEntry {
  id: string;
  runNumber: number | null;
  trigger: 'manual' | 'scheduled' | 'local';
  target?: Target;
  startedAt: string;
  durationMs: number;
  rounds: number;
  commit: string | null;
  totals: Totals;
  brokenRounds: number;
  /** Missing in runs recorded before case selection existed. */
  selection?: 'all' | 'subset';
  caseCount?: number;
  catalogSize?: number;
  customData?: boolean;
}

export interface CaseResult {
  round: number;
  status: ResultStatus;
  durationMs: number;
  error: string | null;
  errors?: string[];
  skipReason: string | null;
  blocked: boolean;
  screenshot: string | null;
  reportLink: string;
}

export interface CaseSummary {
  id: string;
  module: string;
  title: string;
  file: string;
  results: CaseResult[];
  passRate: number | null;
  params?: { key: string; value: string | number; default: string | number }[];
}

export interface RoundSummary {
  round: number;
  startedAt: string;
  durationMs: number;
  passed: number;
  failed: number;
  skipped: number;
  report: string;
  error: string | null;
}

/** data/runs/<id>/summary.json */
export interface RunSummary {
  schemaVersion: number;
  id: string;
  runNumber: number | null;
  trigger: RunEntry['trigger'];
  target?: Target;
  commit: string | null;
  repoUrl: string | null;
  workflowRunUrl: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  rounds: number;
  selection?: { all: boolean; cases: string[]; applicable?: number; catalogSize: number };
  browser: string;
  playwrightVersion: string;
  baseURL: string;
  totals: Totals;
  brokenRounds: number;
  roundSummaries: RoundSummary[];
  cases: CaseSummary[];
}

/** The fixture runs, newest first. */
export const RUNS = {
  /** Local run, 1 round, TC02/TC04/TC05/TC12, custom test data for TC02 (position 3) and TC04 (keyword "pliers"). */
  local: 'local-20261006-133000',
  /** Run #3, 3 rounds: TC09 blocked by the bot check, TC11 fails in round 2 (with a screenshot), TC14 and TC16 pass. */
  mixed: '21000000003',
  /** Run #2, 2 rounds: round 2 produced no results ("broken"). */
  broken: '21000000002',
  /** Run #1, weekly schedule, recorded before case selection existed (schema 1, no caseCount/catalogSize). */
  legacy: '21000000001',
} as const;

const RESULTS_DIR = path.join(ROOT, SITE.dataDir);
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

export const fixtureRuns = (): RunEntry[] => readJson<RunEntry[]>(path.join(RESULTS_DIR, 'runs.json'));

export const fixtureSummary = (id: string): RunSummary => readJson<RunSummary>(path.join(RESULTS_DIR, 'runs', id, 'summary.json'));

const totalsOf = (statuses: ResultStatus[]): Totals => {
  const count = (status: ResultStatus) => statuses.filter((s) => s === status).length;
  const [passed, failed, skipped] = [count('passed'), count('failed'), count('skipped')];
  return { passed, failed, skipped, total: statuses.length, passRate: passed + failed ? passed / (passed + failed) : null };
};

export interface CaseOutcome {
  id: string;
  /** One status per round. */
  statuses: ResultStatus[];
  /** Error message(s) for failed rounds (defaults to a generic expect error). */
  errors?: string[];
  /** Test data that differs from the defaults of config/cases.json. */
  params?: Record<string, string | number>;
}

export interface PublishedRun {
  entry: RunEntry;
  summary: RunSummary;
}

/**
 * A run as the workflow publishes it (history entry + summary), built from
 * one status per case and round. Titles, modules and default test data come
 * from the site's catalog.
 */
export function publishedRun({
  id,
  runNumber,
  startedAt,
  cases,
  target = 'production',
  baseURL = target === 'with-bugs' ? 'https://with-bugs.practicesoftwaretesting.com' : 'https://practicesoftwaretesting.com',
}: {
  id: string;
  runNumber: number;
  startedAt: Date;
  cases: CaseOutcome[];
  target?: Target;
  baseURL?: string;
}): PublishedRun {
  const catalog = siteCatalog();
  const applicable = applicableCaseCount(target);
  const full = cases.length === applicable;
  const rounds = Math.max(...cases.map((c) => c.statuses.length));
  const caseMs = 4_000;
  const durationMs = 60_000 + rounds * cases.length * caseMs;
  const report = (round: number) => `rounds/round-${round}/report/index.html`;
  const summaries: CaseSummary[] = cases.map(({ id: caseId, statuses, errors, params = {} }) => {
    const known = catalog.cases.find((c) => c.id === caseId);
    if (!known) throw new Error(`${caseId} is not in the catalog`);
    const messages = errors?.length ? errors : ['Error: expect(locator).toBeVisible() failed'];
    return {
      id: caseId,
      module: known.module,
      title: known.title,
      file: path.basename(known.file),
      results: statuses.map((status, i) => ({
        round: i + 1,
        status,
        durationMs: caseMs,
        error: status === 'failed' ? messages[0] : null,
        ...(status === 'failed' ? { errors: messages } : {}),
        skipReason: null,
        blocked: false,
        screenshot: null,
        reportLink: `${report(i + 1)}#?testId=${caseId.toLowerCase()}`,
      })),
      passRate: totalsOf(statuses).passRate,
      params: Object.entries(known.params).map(([key, def]) => ({ key, value: params[key] ?? def.default, default: def.default })),
    };
  });
  const roundSummaries: RoundSummary[] = Array.from({ length: rounds }, (_, i) => {
    const totals = totalsOf(cases.map((c) => c.statuses[i]).filter((s) => s !== undefined));
    return {
      round: i + 1,
      startedAt: new Date(startedAt.getTime() + i * cases.length * caseMs).toISOString(),
      durationMs: cases.length * caseMs,
      passed: totals.passed,
      failed: totals.failed,
      skipped: totals.skipped,
      report: report(i + 1),
      error: null,
    };
  });
  const totals = totalsOf(cases.flatMap((c) => c.statuses));
  const customData = cases.some((c) => Object.keys(c.params ?? {}).length > 0);
  const commit = 'fedcba9';
  const summary: RunSummary = {
    schemaVersion: 2,
    id,
    runNumber,
    trigger: 'manual',
    target,
    commit,
    repoUrl: 'https://github.com/NTCloudy/baccarat-e2e-dashboard',
    workflowRunUrl: `https://github.com/NTCloudy/baccarat-e2e-dashboard/actions/runs/${id}`,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date(startedAt.getTime() + durationMs).toISOString(),
    durationMs,
    rounds,
    selection: { all: full, cases: cases.map((c) => c.id), applicable, catalogSize: catalog.cases.length },
    browser: 'chromium',
    playwrightVersion: '1.62.1',
    baseURL,
    totals,
    brokenRounds: 0,
    roundSummaries,
    cases: summaries,
  };
  const entry: RunEntry = {
    id,
    runNumber,
    trigger: 'manual',
    target,
    startedAt: summary.startedAt,
    durationMs,
    rounds,
    commit,
    totals,
    brokenRounds: 0,
    selection: full ? 'all' : 'subset',
    caseCount: cases.length,
    catalogSize: applicable,
    customData,
  };
  return { entry, summary };
}

/**
 * Changes what the fixture site serves under data/ for one page, e.g. a run
 * that the workflow publishes while the test runs. Requests are matched by
 * path, so cache-busting queries (?t=...) do not matter.
 */
export class SiteData {
  constructor(private readonly page: Page) {}

  /** Serves `body` as JSON at `sitePath` (relative to the site root, e.g. "data/runs.json"). */
  async serveJson(sitePath: string, body: unknown, status = 200): Promise<void> {
    await this.page.route(
      (url) => url.pathname === `/${sitePath}`,
      (route) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) }),
    );
  }

  /** Replaces data/runs.json (the run history). */
  async setRuns(runs: RunEntry[]): Promise<void> {
    await this.serveJson('data/runs.json', runs);
  }

  /** Puts a run on the site as the workflow's deploy job does: its summary, and first in the history. */
  async publish(run: PublishedRun): Promise<void> {
    await this.serveJson(`data/runs/${run.entry.id}/summary.json`, run.summary);
    await this.setRuns([run.entry, ...fixtureRuns()]);
  }
}
