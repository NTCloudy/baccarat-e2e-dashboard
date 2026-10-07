#!/usr/bin/env node
/**
 * Builds <RUN_DIR>/summary.json from the per-round Playwright JSON reports.
 *
 * - One entry per test case (TCxx), with the result of every round and the
 *   test data it used (defaults from config/cases.json + this run's overrides).
 * - The target site (production or with-bugs, shared/targets.mjs) and whether
 *   the run covered every case that applies to it.
 * - Failure screenshots are copied next to the round report so the dashboard
 *   can show them inline.
 * - In GitHub Actions it also writes step outputs (failed/total) and a
 *   Markdown job summary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { simulateRounds } from '../app/engine.mjs';
import { applicableCases, caseIds, paramEntries, resolveCase } from '../shared/case-params.mjs';
import { DEFAULT_TARGET, resolveTarget, TARGETS } from '../shared/targets.mjs';
import { loadConfig } from './lib/catalog.mjs';

const runDir = path.resolve(process.env.RUN_DIR ?? 'test-output/run');
const metaPath = path.join(runDir, 'run-meta.json');
if (!fs.existsSync(metaPath)) {
  console.error(`No run-meta.json in ${runDir}. Run scripts/run-rounds.mjs first.`);
  process.exit(1);
}
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const config = loadConfig();
// Runs recorded before case selection existed ran every case with the defaults.
const selection = meta.selection ?? { all: true, cases: caseIds(config), params: {} };
// run-rounds.mjs records the target; runs recorded before targets existed ran on production.
const resolved = resolveTarget(meta.target);
if (resolved.error) console.warn(`Warning: run-meta.json: ${resolved.error}; recording the run as ${DEFAULT_TARGET}.`);
const target = resolved.error ? DEFAULT_TARGET : resolved.name;
const baseURL = meta.baseURL ?? process.env.BASE_URL ?? TARGETS[target].baseURL;
const apiURL = meta.apiURL ?? process.env.API_URL ?? TARGETS[target].apiURL;

// eslint-disable-next-line no-control-regex -- strips ANSI colour codes from Playwright error messages
const ANSI = /\u001b\[[0-9;]*m/g;
const CASE_TITLE = /^(TC\d{2})\s+(.+)$/;
const MAX_ERRORS = 10;
const MAX_ERROR_LENGTH = 2000;

function stripAnsi(text) {
  return (text ?? '').replace(ANSI, '');
}

/** All failure messages of a Playwright result, cleaned and capped. */
function errorMessages(result) {
  const raw = (result?.errors ?? []).map((e) => e.message ?? e.value ?? '');
  if (!raw.length && result?.error) raw.push(result.error.message ?? result.error.value ?? '');
  const messages = raw.map((text) => stripAnsi(String(text)).slice(0, MAX_ERROR_LENGTH)).filter(Boolean);
  return (messages.length ? messages : ['Unknown error']).slice(0, MAX_ERRORS);
}

/** Walks nested suites and yields { spec, module } pairs. */
function* walkSpecs(suites, parents = []) {
  for (const suite of suites ?? []) {
    const chain = suite.file && suite.title === suite.file ? parents : [...parents, suite.title];
    for (const spec of suite.specs ?? []) yield { spec, module: chain[chain.length - 1] ?? '' };
    yield* walkSpecs(suite.suites, chain);
  }
}

function normalizeStatus(status) {
  if (status === 'passed') return 'passed';
  if (status === 'skipped') return 'skipped';
  return 'failed'; // failed, timedOut, interrupted
}

function runInfo() {
  const env = process.env;
  const isCI = env.GITHUB_ACTIONS === 'true';
  const trigger = !isCI ? 'local' : env.GITHUB_EVENT_NAME === 'schedule' ? 'scheduled' : 'manual';
  const stamp = meta.startedAt.replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const repoUrl = isCI ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}` : null;
  return {
    id: isCI ? `${env.GITHUB_RUN_ID}` : `local-${stamp}`,
    runNumber: isCI ? Number(env.GITHUB_RUN_NUMBER) : null,
    trigger,
    commit: isCI ? env.GITHUB_SHA.slice(0, 7) : null,
    repoUrl,
    workflowRunUrl: isCI ? `${repoUrl}/actions/runs/${env.GITHUB_RUN_ID}` : null,
  };
}

const cases = new Map();
const roundSummaries = [];

for (const { round, durationMs, startedAt } of meta.roundMeta) {
  const roundRel = `rounds/round-${round}`;
  const roundDir = path.join(runDir, roundRel);
  const reportFile = path.join(roundDir, 'results.json');
  const summary = { round, startedAt, durationMs, passed: 0, failed: 0, skipped: 0, report: `${roundRel}/report/index.html`, error: null };

  if (!fs.existsSync(reportFile)) {
    summary.error = 'No results.json was produced for this round.';
    roundSummaries.push(summary);
    continue;
  }

  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  if (report.errors?.length) summary.error = stripAnsi(report.errors.map((e) => e.message).join('\n')).slice(0, 2000);

  for (const { spec, module } of walkSpecs(report.suites)) {
    const match = CASE_TITLE.exec(spec.title);
    const caseId = match ? match[1] : spec.title;
    const test = spec.tests?.[0];
    const result = test?.results?.[test.results.length - 1];
    const status = normalizeStatus(result?.status ?? 'skipped');
    summary[status]++;

    let screenshot = null;
    if (status === 'failed') {
      const shot = result?.attachments?.find((a) => a.name === 'screenshot' && a.path && fs.existsSync(a.path));
      if (shot) {
        const rel = `${roundRel}/shots/${caseId}.png`;
        fs.mkdirSync(path.join(runDir, roundRel, 'shots'), { recursive: true });
        fs.copyFileSync(shot.path, path.join(runDir, rel));
        screenshot = rel;
      }
    }

    if (!cases.has(caseId)) {
      cases.set(caseId, { id: caseId, module, title: match ? match[2] : spec.title, file: spec.file, results: [] });
    }
    // Runtime skips carry their reason as a "skip" annotation; "blocked" marks a bot-check block (src/support/botCheck.ts).
    const annotations = result?.annotations ?? test?.annotations ?? [];
    cases.get(caseId).results.push({
      round,
      status,
      durationMs: result?.duration ?? 0,
      error: status === 'failed' ? stripAnsi(result?.error?.message ?? result?.errors?.[0]?.message ?? 'Unknown error').slice(0, MAX_ERROR_LENGTH) : null,
      // Every failure message (soft assertions add one each); shared/bug-detection.mjs matches all of them.
      ...(status === 'failed' ? { errors: errorMessages(result) } : {}),
      skipReason: status === 'skipped' ? (annotations.find((a) => a.type === 'skip')?.description ?? null) : null,
      blocked: status === 'skipped' && annotations.some((a) => a.type === 'blocked'),
      screenshot,
      reportLink: `${roundRel}/report/index.html#?testId=${encodeURIComponent(spec.id)}`,
    });
  }

  // The HTML report already contains copies of traces, videos and screenshots.
  fs.rmSync(path.join(roundDir, 'artifacts'), { recursive: true, force: true });
  roundSummaries.push(summary);
}

const caseList = [...cases.values()].sort((a, b) => a.id.localeCompare(b.id));
for (const c of caseList) {
  const executed = c.results.filter((r) => r.status !== 'skipped');
  c.passRate = executed.length ? executed.filter((r) => r.status === 'passed').length / executed.length : null;
  // The defaults are stored too, so the dashboard can mark custom values even after config/cases.json changes.
  const { values } = resolveCase(config, c.id, selection.params?.[c.id] ?? {});
  c.params = paramEntries(config, c.id).map(([key, def]) => ({ key, value: values[key], default: def.default }));
}

const totals = roundSummaries.reduce(
  (acc, r) => ({ passed: acc.passed + r.passed, failed: acc.failed + r.failed, skipped: acc.skipped + r.skipped }),
  { passed: 0, failed: 0, skipped: 0 },
);
totals.total = totals.passed + totals.failed + totals.skipped;
const executedTotal = totals.passed + totals.failed;
totals.passRate = executedTotal ? totals.passed / executedTotal : null;
// A round that produced no results at all is a failure even without failed tests.
const brokenRounds = roundSummaries.filter((r) => r.passed + r.failed + r.skipped === 0).length;

const summary = {
  schemaVersion: 3,
  ...runInfo(),
  startedAt: meta.startedAt,
  finishedAt: meta.finishedAt,
  durationMs: new Date(meta.finishedAt) - new Date(meta.startedAt),
  rounds: meta.rounds,
  // The site under test (shared/targets.mjs). Summaries without it are production runs.
  target,
  // `all`: every case that runs on the target was selected (`applicable` of the `catalogSize` cases).
  selection: { all: selection.all, cases: selection.cases, catalogSize: caseIds(config).length, applicable: applicableCases(config, target).length },
  browser: 'chromium',
  playwrightVersion: pkg.devDependencies['@playwright/test'],
  baseURL,
  apiURL,
  totals,
  brokenRounds,
  roundSummaries,
  rtpSimulation: simulateRounds(100_000, target, 20261007),
  cases: caseList,
};
fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));

const pct = (v) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
console.log(
  `Run ${summary.id} on ${target}: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped (${pct(totals.passRate)}) over ${meta.rounds} round(s).`,
);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `failed=${totals.failed + brokenRounds}\ntotal=${totals.total}\nrun_id=${summary.id}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const header = `| Case | ${roundSummaries.map((r) => `R${r.round}`).join(' | ')} | Pass rate |\n|---|${roundSummaries.map(() => ':-:').join('|')}|:-:|\n`;
  const icon = { passed: '✅', failed: '❌', skipped: '⏭️', blocked: '🛡️' };
  const cell = (result) => (result ? icon[result.blocked ? 'blocked' : result.status] : '—');
  const rows = caseList
    .map((c) => `| ${c.id} ${c.title} | ${roundSummaries.map((r) => cell(c.results.find((x) => x.round === r.round))).join(' | ')} | ${pct(c.passRate)} |`)
    .join('\n');
  const anyBlocked = caseList.some((c) => c.results.some((r) => r.blocked));
  const legend = anyBlocked ? `\n${icon.blocked} Skipped: blocked by the site's Cloudflare bot check on the CI runner (not a product failure).\n` : '';
  const scope = selection.all
    ? `Cases: all ${summary.selection.applicable}${summary.selection.applicable < summary.selection.catalogSize ? ` that run on ${target}` : ''}`
    : `Cases: ${caseList.length} of ${summary.selection.applicable} (${caseList.map((c) => c.id).join(', ')})`;
  // Values only contain letters, digits, spaces and . , ' & ( ) / + - (shared/case-params.mjs), so code spans are safe.
  const custom = caseList.flatMap((c) => c.params.filter((p) => p.value !== p.default).map((p) => `\`${c.id}.${p.key} = ${JSON.stringify(p.value)}\``));
  const data = custom.length ? `Custom test data: ${custom.join(', ')}` : 'Test data: defaults from config/cases.json';
  const site = `Target: ${target} (${baseURL})${TARGETS[target].injectedBugs ? ', a release with intentionally injected bugs: failures are expected (see the verdict below)' : ''}`;
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## E2E results: ${pct(totals.passRate)} passed (${totals.passed}/${executedTotal})\n\n${site}  \n${scope}  \n${data}\n\n${header}${rows}\n${legend}`,
  );
}
