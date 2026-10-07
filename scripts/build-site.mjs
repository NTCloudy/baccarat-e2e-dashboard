#!/usr/bin/env node
/**
 * Assembles the static results website:
 *   <out>/                  <- dashboard/ (HTML, CSS, JS)
 *   <out>/case-params.js    <- shared/case-params.mjs (same test data rules as CI)
 *   <out>/descriptions.js   <- shared/descriptions.mjs (same title/description rules as this script)
 *   <out>/targets.js        <- shared/targets.mjs (the sites a run can target)
 *   <out>/bug-detection.js  <- shared/bug-detection.mjs (same bug matching as the CI verdict)
 *   <out>/catalog.json      <- test cases: test data schema, code location, titles and
 *                              descriptions; and config/known-bugs.json (`knownBugs`)
 *   <out>/docs/bugs/        <- evidence images referenced by config/known-bugs.json
 *   <out>/data/             <- runs.json + runs/<id>/ (summaries, HTML reports, screenshots)
 *
 * The dashboard also reads the latest config/descriptions.json from GitHub at
 * runtime, so an edit made in the test console shows up without a rebuild.
 *
 * Usage:
 *   node scripts/build-site.mjs --data-dir test-output/site-data --out _site
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadCatalog, loadDescriptions, loadKnownBugs, ROOT } from './lib/catalog.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dashboardDir = path.join(ROOT, 'dashboard');
const dataDir = path.resolve(arg('data-dir', 'test-output/site-data'));
const outDir = path.resolve(arg('out', '_site'));

// Check everything before touching the output folder.
let config, cases, descriptions, knownBugs;
try {
  ({ config, cases } = loadCatalog());
  descriptions = loadDescriptions(cases);
  knownBugs = loadKnownBugs(config);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync(dashboardDir, outDir, { recursive: true });
// Served as .js so every static host uses a JavaScript MIME type.
for (const name of ['case-params', 'descriptions', 'targets', 'bug-detection']) {
  fs.copyFileSync(path.join(ROOT, 'shared', `${name}.mjs`), path.join(outDir, `${name}.js`));
}
// Evidence images keep their repository path (docs/bugs/…), so the same path works on the site.
const evidence = [...knownBugs.bugs, ...(knownBugs.unlisted ?? [])].map((entry) => entry.evidence).filter(Boolean);
for (const file of new Set(evidence)) {
  fs.mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, file), path.join(outDir, file));
}

// Source links in the console point at the commit the site was built from.
let commit = process.env.GITHUB_SHA ?? null;
try {
  commit ??= execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout */
}
// The editor's note ($comment) is for people editing the file, not for the site.
const bugList = Object.fromEntries(Object.entries(knownBugs).filter(([key]) => key !== '$comment'));
fs.writeFileSync(
  path.join(outDir, 'catalog.json'),
  JSON.stringify({ commit, builtAt: new Date().toISOString(), lists: config.lists ?? {}, cases, descriptions, knownBugs: bugList }, null, 2),
);

const outData = path.join(outDir, 'data');
if (fs.existsSync(dataDir)) {
  fs.cpSync(dataDir, outData, { recursive: true });
} else {
  console.warn(`No data folder at ${dataDir}; the site will show an empty history.`);
  fs.mkdirSync(outData, { recursive: true });
}
if (!fs.existsSync(path.join(outData, 'runs.json'))) {
  fs.writeFileSync(path.join(outData, 'runs.json'), '[]\n');
}

const runs = JSON.parse(fs.readFileSync(path.join(outData, 'runs.json'), 'utf8'));
console.log(
  `Site built in ${outDir} with ${runs.length} run(s), ${cases.length} test case(s) and ${knownBugs.bugs.length + (knownBugs.unlisted?.length ?? 0)} known bug(s).`,
);
