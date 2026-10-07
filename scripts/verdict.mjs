#!/usr/bin/env node
/**
 * Decides whether a run is green or red, after its results are published.
 *
 * - production: any failed result, or a round without results, is red.
 * - with-bugs (a release with intentionally injected bugs): failures are
 *   expected. shared/bug-detection.mjs matches every failure message to
 *   config/known-bugs.json. The run is red when an in-scope known bug was
 *   missed (its detecting case ran and passed, or failed for another reason),
 *   when a failure matches nothing (unclassified), or when a round produced no
 *   results. Cases blocked by a known bug and cases that did not run (e.g.
 *   skipped by the site's bot check) are not red.
 *
 * Usage:
 *   node scripts/verdict.mjs [--run-dir test-output/run] [--known-bugs <file>] [--report-only]
 *
 * Exits with 1 when red; with --report-only it always exits with 0 (CI keeps
 * going so the dashboard is still deployed, and the Verdict job fails later).
 * In GitHub Actions it also writes the step outputs `verdict` (green | red)
 * and `verdict_summary`, and a section in the job summary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { classifyRun, findingRef, messagesOf } from '../shared/bug-detection.mjs';
import { TARGETS, targetOf } from '../shared/targets.mjs';
import { KNOWN_BUGS_PATH, loadConfig, loadKnownBugs } from './lib/catalog.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const runDir = path.resolve(arg('run-dir', process.env.RUN_DIR ?? 'test-output/run'));
const knownBugsFile = path.resolve(arg('known-bugs', KNOWN_BUGS_PATH));
const reportOnly = process.argv.includes('--report-only');

/** Records the verdict for the workflow and exits. */
function finish(green, summary, markdown) {
  console.log(`Verdict: ${green ? 'GREEN' : 'RED'}: ${summary}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${green ? 'green' : 'red'}\nverdict_summary=${summary.replace(/[\r\n]+/g, ' ')}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY && markdown) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  process.exit(green || reportOnly ? 0 : 1);
}

let summary;
try {
  summary = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8'));
} catch (error) {
  finish(false, `no readable summary.json in ${runDir} (${error.message}).`);
}

const target = targetOf(summary);
const icon = (green) => (green ? '✅' : '❌');
const firstLine = (text) => String(text ?? '').split('\n').find((line) => line.trim()) ?? '';
const short = (text, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

if (!TARGETS[target].injectedBugs) {
  // Production: every executed test must pass.
  const { passed, failed, skipped, total } = summary.totals;
  const broken = summary.brokenRounds ?? 0;
  const green = failed === 0 && broken === 0 && total > 0;
  const text = green
    ? `all ${passed} executed result(s) passed on ${target}${skipped ? ` (${skipped} skipped)` : ''}.`
    : [failed ? `${failed} of ${total} result(s) failed` : '', broken ? `${broken} round(s) produced no results` : '', total ? '' : 'no results']
        .filter(Boolean)
        .join('; ') + ` on ${target}.`;
  finish(green, text, `## Verdict: ${icon(green)} ${green ? 'green' : 'red'}\n\n${text}\n`);
}

// with-bugs: judge the failures against the known bugs.
let knownBugs;
try {
  knownBugs = loadKnownBugs(loadConfig(), knownBugsFile);
} catch (error) {
  console.error(error.message);
  finish(false, `cannot judge the with-bugs run: ${firstLine(error.message)}`);
}
const result = classifyRun(summary, knownBugs);
const { counts } = result;
const casesOf = (finding) => finding.entry.cases.join(', ');

console.log(`Target: ${target} (${summary.baseURL})`);
console.log(`Known bugs in scope: ${counts.inScope} · caught ${counts.caught} · missed ${counts.missed} · blocked ${counts.blocked} · not run ${counts.notRun}`);
for (const bug of result.bugs) console.log(`  ${bug.status.padEnd(7)} ${bug.ref.padEnd(4)} ${casesOf(bug).padEnd(12)} ${bug.entry.title.en}`);
console.log(`Unlisted findings: ${counts.unlistedCaught} of ${counts.unlisted} seen`);
for (const finding of result.unlisted) console.log(`  ${finding.status.padEnd(7)} ${finding.ref} (${casesOf(finding)})`);
const blockedCases = Object.values(result.cases).filter((c) => c.status === 'blocked');
console.log(`Blocked cases: ${blockedCases.length ? blockedCases.map((c) => `${c.id} (by ${c.blockedBy.join(', ')})`).join(', ') : 'none'}`);
console.log(`Unclassified failures: ${result.unclassified.length || 'none'}`);
for (const u of result.unclassified) console.log(`  ${u.caseId} round ${u.round}: ${short(firstLine(u.message), 200)}`);
if (result.brokenRounds.length) console.log(`Rounds without results: ${result.brokenRounds.join(', ')}`);

const missed = result.bugs.filter((bug) => bug.status === 'missed');
const problems = [
  missed.length ? `missed ${missed.map((bug) => bug.ref).join(', ')}` : '',
  result.unclassified.length ? `${result.unclassified.length} unclassified failure(s) in ${[...new Set(result.unclassified.map((u) => u.caseId))].join(', ')}` : '',
  result.brokenRounds.length ? `${result.brokenRounds.length} round(s) produced no results` : '',
].filter(Boolean);
const green = result.ok;
const text = green
  ? `caught ${counts.caught} of ${counts.inScope} in-scope known bug(s)${counts.blocked ? `, ${counts.blocked} blocked` : ''}${counts.notRun ? `, ${counts.notRun} not run` : ''}; every failure is explained.`
  : `${problems.join('; ')} (caught ${counts.caught} of ${counts.inScope}).`;

const STATUS = { caught: '✅ caught', missed: '❌ missed', blocked: '⛔ blocked', notRun: '⏭️ not run' };
const rows = [...result.bugs, ...result.unlisted]
  .map((f) => `| ${f.entry.id !== undefined ? findingRef(f.entry) : `unlisted: ${f.ref}`} | ${f.entry.title.en} | ${casesOf(f)} | ${STATUS[f.status]} |`)
  .join('\n');
const unclassified = result.unclassified.length
  ? `\n**Unclassified failures** (a new bug, an environment problem or a broken test; add them to config/known-bugs.json or fix the test):\n\n${result.unclassified
      .map((u) => `- ${u.caseId} round ${u.round}: \`${short(firstLine(u.message)).replace(/`/g, "'")}\``)
      .join('\n')}\n`
  : '';
const blocked = blockedCases.length ? `\nBlocked (a known bug breaks their precondition): ${blockedCases.map((c) => `${c.id} by ${c.blockedBy.join(', ')}`).join(', ')}.\n` : '';
const markdown = `## Bug detection on ${target}: ${icon(green)} ${green ? 'green' : 'red'}

${text}

| Bug | Title | Detected by | Status |
|---|---|---|---|
${rows}
${blocked}${unclassified}
Failure messages checked: ${summary.cases.reduce((n, c) => n + c.results.filter((r) => r.status === 'failed').reduce((m, r) => m + messagesOf(r).length, 0), 0)}. Known bugs: config/known-bugs.json (${counts.outOfScope} official bug(s) out of scope).
`;
finish(green, text, markdown);
