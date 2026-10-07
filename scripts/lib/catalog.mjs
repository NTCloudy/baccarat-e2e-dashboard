/**
 * The test case catalog: config/cases.json (test data) joined with the test
 * code (title, module, file and line, from `playwright test --list`).
 *
 * Used by run-rounds.mjs (fail fast before a run when the two disagree), by
 * build-site.mjs (catalog.json for the dashboard's test console) and by
 * check-config.mjs (CI). Also loads and checks config/descriptions.json and
 * config/known-bugs.json against the catalog.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkKnownBugs, describeBugError } from '../../shared/bug-detection.mjs';
import { applicableCases, caseIds, checkConfig, describeError } from '../../shared/case-params.mjs';
import { checkDescriptions, describeDocError } from '../../shared/descriptions.mjs';
import { TARGET_NAMES, TARGETS } from '../../shared/targets.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CONFIG_PATH = path.join(ROOT, 'config', 'cases.json');
export const DESCRIPTIONS_PATH = path.join(ROOT, 'config', 'descriptions.json');
export const KNOWN_BUGS_PATH = path.join(ROOT, 'config', 'known-bugs.json');
const CASE_TITLE = /^(TC\d{2})\s+(.+)$/;

export function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

/**
 * Reads config/descriptions.json and checks it against the catalog's cases
 * (every case has a title and description in each language; placeholders only
 * use the case's own test data). Prints warnings; throws an error with a
 * `problems` list when the file is invalid.
 */
export function loadDescriptions(cases) {
  const descriptions = JSON.parse(fs.readFileSync(DESCRIPTIONS_PATH, 'utf8'));
  const { errors, warnings } = checkDescriptions(
    descriptions,
    cases.map((c) => c.id),
    (id) => Object.keys(cases.find((c) => c.id === id)?.params ?? {}),
  );
  for (const warning of warnings) console.warn(`Warning: config/descriptions.json: ${describeDocError(warning)}`);
  if (errors.length) {
    const problems = errors.map(describeDocError);
    const error = new Error(`config/descriptions.json has problems:\n- ${problems.join('\n- ')}`);
    error.problems = problems;
    throw error;
  }
  return descriptions;
}

/**
 * Reads config/known-bugs.json (or another copy, `file`) and checks it against
 * config/cases.json: the detecting and blocked cases exist and run on the
 * with-bugs target, patterns compile, ids are on the official list once, and
 * evidence files exist. Throws an error with a `problems` list when the file
 * is invalid.
 */
export function loadKnownBugs(config, file = KNOWN_BUGS_PATH) {
  const name = file === KNOWN_BUGS_PATH ? 'config/known-bugs.json' : file;
  const knownBugs = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bugTargets = TARGET_NAMES.filter((target) => TARGETS[target].injectedBugs);
  const errors = checkKnownBugs(knownBugs, {
    cases: caseIds(config),
    runnable: caseIds(config).filter((id) => bugTargets.some((target) => applicableCases(config, target).includes(id))),
    evidenceExists: (evidence) => fs.existsSync(path.join(ROOT, evidence)),
  });
  if (errors.length) {
    const problems = errors.map(describeBugError);
    const error = new Error(`${name} has problems:\n- ${problems.join('\n- ')}`);
    error.problems = problems;
    throw error;
  }
  return knownBugs;
}

/** Test cases found in the code, without running them. */
export function listTestCases() {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-list-')), 'list.json');
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    const result = spawnSync(npx, ['playwright', 'test', '--list', '--reporter=json'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: outFile },
    });
    if (result.status !== 0 || !fs.existsSync(outFile)) {
      throw new Error(`"playwright test --list" failed (exit code ${result.status}):\n${result.stderr || result.stdout}`);
    }
    const report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    const cases = [];
    const walk = (suites, module) => {
      for (const suite of suites ?? []) {
        const isFile = suite.title === suite.file;
        const current = isFile ? module : suite.title;
        for (const spec of suite.specs ?? []) {
          const match = CASE_TITLE.exec(spec.title);
          const file = path.relative(ROOT, path.join(report.config.rootDir, spec.file)).split(path.sep).join('/');
          cases.push({ id: match?.[1] ?? null, title: match?.[2] ?? spec.title, module: current ?? '', file, line: spec.line });
        }
        walk(suite.suites, current);
      }
    };
    walk(report.suites, null);
    return cases;
  } finally {
    fs.rmSync(path.dirname(outFile), { recursive: true, force: true });
  }
}

/**
 * Joins config and code. Throws an error with a `problems` list when the
 * config is invalid or a case exists on only one side.
 */
export function loadCatalog() {
  const config = loadConfig();
  const tests = listTestCases();
  const ids = caseIds(config);
  const problems = checkConfig(config, { targets: TARGET_NAMES }).map(describeError);

  for (const test of tests) {
    if (!test.id) problems.push(`${test.file}:${test.line}: the test title "${test.title}" must start with a case id such as "TC17 "`);
    else if (!ids.includes(test.id)) problems.push(`${test.id}: the test in ${test.file} has no entry in config/cases.json (add "${test.id}": {})`);
  }
  for (const id of ids) {
    const count = tests.filter((test) => test.id === id).length;
    if (count === 0) problems.push(`${id}: listed in config/cases.json, but no test title starts with "${id} "`);
    if (count > 1) problems.push(`${id}: ${count} tests use this case id`);
  }
  if (problems.length) {
    const error = new Error(`The test catalog is inconsistent:\n- ${problems.join('\n- ')}`);
    error.problems = problems;
    throw error;
  }

  const cases = ids.map((id) => {
    const test = tests.find((t) => t.id === id);
    const entry = config.cases[id];
    return {
      id,
      title: test.title,
      module: test.module,
      file: test.file,
      line: test.line,
      params: entry.params ?? {},
      rules: entry.rules ?? [],
      // null: the case runs on every target.
      targets: entry.targets ?? null,
    };
  });
  return { config, cases };
}
