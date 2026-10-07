#!/usr/bin/env node
/**
 * Copies one finished run into the dashboard data folder and updates the run
 * index (runs.json). Only the newest runs are kept, plus the latest full run
 * of each target (shared/targets.mjs): the dashboard's Bug page compares the
 * latest full with-bugs run with the latest full production run, so neither
 * may be pruned however many partial runs come after it.
 *
 * Usage:
 *   node scripts/publish.mjs --run-dir test-output/run --data-dir site-data --keep 30
 */
import fs from 'node:fs';
import path from 'node:path';
import { latestFullRun, TARGET_NAMES, targetOf, TARGETS } from '../shared/targets.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const runDir = path.resolve(arg('run-dir', process.env.RUN_DIR ?? 'test-output/run'));
const dataDir = path.resolve(arg('data-dir', 'test-output/site-data'));
const keep = Number(arg('keep', '30'));

const summaryPath = path.join(runDir, 'summary.json');
if (!fs.existsSync(summaryPath)) {
  console.error(`No summary.json in ${runDir}. Run scripts/aggregate.mjs first.`);
  process.exit(1);
}
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

const runsDir = path.join(dataDir, 'runs');
const runFolder = path.join(runsDir, summary.id);
fs.rmSync(runFolder, { recursive: true, force: true });
fs.mkdirSync(runFolder, { recursive: true });
fs.copyFileSync(summaryPath, path.join(runFolder, 'summary.json'));
fs.cpSync(path.join(runDir, 'rounds'), path.join(runFolder, 'rounds'), {
  recursive: true,
  filter: (src) => !src.split(path.sep).includes('artifacts'),
});

const indexPath = path.join(dataDir, 'runs.json');
const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];
const target = targetOf(summary);
const entry = {
  id: summary.id,
  runNumber: summary.runNumber,
  trigger: summary.trigger,
  startedAt: summary.startedAt,
  durationMs: summary.durationMs,
  rounds: summary.rounds,
  commit: summary.commit,
  // The site under test; entries without it are production runs.
  target,
  baseURL: summary.baseURL ?? TARGETS[target].baseURL,
  // "all": every case that applies to the target was selected; otherwise the ids that were.
  selection: summary.selection?.all === false ? summary.cases.map((c) => c.id) : 'all',
  totals: summary.totals,
  brokenRounds: summary.brokenRounds,
  caseCount: summary.cases.length,
  catalogSize: summary.selection?.catalogSize ?? summary.cases.length,
  customData: summary.cases.some((c) => (c.params ?? []).some((p) => p.value !== p.default)),
};
const byNewest = (a, b) => b.startedAt.localeCompare(a.startedAt);
const all = [entry, ...index.filter((r) => r.id !== summary.id)].sort(byNewest);
const updated = all.slice(0, keep);
for (const name of TARGET_NAMES) {
  const reference = latestFullRun(all, name);
  if (reference && !updated.includes(reference)) {
    updated.push(reference);
    console.log(`Kept run ${reference.id}: the latest full run on ${name}.`);
  }
}
updated.sort(byNewest);
fs.writeFileSync(indexPath, JSON.stringify(updated, null, 2));

// Remove run folders that are no longer referenced by the index.
const kept = new Set(updated.map((r) => r.id));
for (const dir of fs.readdirSync(runsDir)) {
  if (!kept.has(dir)) {
    fs.rmSync(path.join(runsDir, dir), { recursive: true, force: true });
    console.log(`Pruned old run ${dir}`);
  }
}
console.log(`Published run ${summary.id} (${target}) to ${runFolder} (${updated.length} run(s) in index).`);
