#!/usr/bin/env node
/**
 * Runs the Playwright suite N times ("rounds"). Each round writes its own
 * JSON + HTML report to <RUN_DIR>/rounds/round-<k>/ so that aggregate.mjs can
 * build a "test case x round" matrix.
 *
 * Which site, which cases, and with which test data comes from optional
 * environment variables (the workflow inputs, usually filled in by the
 * dashboard's test console):
 *   TARGET       "production" (default) or "with-bugs" (shared/targets.mjs);
 *                sets BASE_URL and API_URL for the tests
 *   CASES        comma-separated case ids, e.g. "TC04,TC12" (empty = all cases
 *                that apply to the target)
 *   CASE_PARAMS  test data overrides as JSON, e.g. {"TC04":{"keyword":"pliers"}}
 * They are validated with shared/targets.mjs and shared/case-params.mjs before
 * any test runs. Cases limited to other targets ("targets" in
 * config/cases.json) are never run.
 *
 * Usage:
 *   ROUNDS=3 node scripts/run-rounds.mjs
 *   TARGET=with-bugs node scripts/run-rounds.mjs 1
 *   CASES=TC04 CASE_PARAMS='{"TC04":{"keyword":"pliers"}}' node scripts/run-rounds.mjs 2
 *   node scripts/run-rounds.mjs 3 -- --headed   # extra args go to `playwright test`
 *
 * The exit code is 0 even when tests fail: failures are counted by
 * aggregate.mjs, so results are still published when some tests are red. An
 * invalid request exits with code 2 before any test runs.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describeError, resolveRun } from '../shared/case-params.mjs';
import { resolveTarget } from '../shared/targets.mjs';
import { loadCatalog } from './lib/catalog.mjs';

const MAX_ROUNDS = 10;
const inGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const separator = process.argv.indexOf('--');
const positional = process.argv.slice(2, separator === -1 ? undefined : separator);
const playwrightArgs = separator === -1 ? [] : process.argv.slice(separator + 1);

/** Workflow command data must not contain raw newlines or "%" (they would end or change the command). */
const ghEscape = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

function report(level, message) {
  if (inGitHubActions) console.log(`::${level} title=Run request::${ghEscape(message)}`);
  else console.error(`${level === 'error' ? 'Error' : 'Warning'}: ${message}`);
}

function fail(messages) {
  for (const message of messages) report('error', message);
  process.exit(2);
}

const rawRounds = process.env.ROUNDS || positional[0] || '1';
const rounds = Number(rawRounds);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
  fail([`ROUNDS must be an integer between 1 and ${MAX_ROUNDS}, got "${String(rawRounds).slice(0, 20)}".`]);
}

const target = resolveTarget(process.env.TARGET);
if (target.error) fail([`TARGET: ${target.error}.`]);

// Which cases, with which test data. Nothing runs when the request is invalid.
let catalog;
try {
  catalog = loadCatalog();
} catch (error) {
  fail(error.problems ?? [error.message]);
}
const request = resolveRun(catalog.config, { cases: process.env.CASES, params: process.env.CASE_PARAMS, target: target.name });
for (const warning of request.warnings) report('warning', describeError(warning));
if (request.errors.length) fail(request.errors.map(describeError));

const total = catalog.cases.length;
const custom = Object.entries(request.params).flatMap(([id, values]) =>
  Object.entries(values).map(([key, value]) => `${id}.${key} = ${JSON.stringify(value)}`),
);
console.log(`Target: ${target.name} (${target.baseURL}, API ${target.apiURL})`);
console.log(
  request.cases.length === total
    ? `Cases: all ${total}`
    : request.all
      ? `Cases: all ${request.cases.length} that run on ${target.name} (${request.cases.join(', ')})`
      : `Cases: ${request.cases.join(', ')} (${request.cases.length} of ${total})`,
);
console.log(custom.length ? `Custom test data: ${custom.join('; ')}` : 'Test data: defaults from config/cases.json');

// Titles start with the case id ("TC04 Search by keyword"); --grep matches the full title path.
// Every run that leaves out a case needs it, also "all cases" on a target some cases do not run on.
const grep = request.cases.length === total ? [] : ['--grep', `(^|\\s)(${request.cases.join('|')})(\\s|$)`];

const runDir = path.resolve(process.env.RUN_DIR ?? 'test-output/run');
fs.rmSync(runDir, { recursive: true, force: true });
fs.mkdirSync(path.join(runDir, 'rounds'), { recursive: true });

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const meta = {
  rounds,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  target: target.name,
  baseURL: target.baseURL,
  apiURL: target.apiURL,
  // `all`: every case that runs on the target was selected.
  selection: { all: request.all, cases: request.cases, params: request.params },
  roundMeta: [],
};

for (let round = 1; round <= rounds; round++) {
  const roundDir = path.join(runDir, 'rounds', `round-${round}`);
  const label = `Round ${round}/${rounds}`;
  console.log(inGitHubActions ? `::group::${label}` : `\n=== ${label} ===`);

  const startedAt = Date.now();
  const result = spawnSync(npx, ['playwright', 'test', ...grep, ...playwrightArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ROUND_DIR: roundDir,
      // The tests read the validated overrides (src/support/testData.ts).
      CASE_PARAMS: JSON.stringify(request.params),
      // The site under test: playwright.config.ts reads BASE_URL, src/api/toolshopApi.ts API_URL,
      // and the tests read TARGET through src/support/target.ts.
      TARGET: target.name,
      BASE_URL: target.baseURL,
      API_URL: target.apiURL,
    },
  });
  meta.roundMeta.push({
    round,
    exitCode: result.status,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
  });

  if (inGitHubActions) console.log('::endgroup::');
  console.log(`${label} finished with exit code ${result.status}.`);
}

meta.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(runDir, 'run-meta.json'), JSON.stringify(meta, null, 2));
console.log(`\nAll ${rounds} round(s) finished. Output: ${runDir}`);
