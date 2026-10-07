#!/usr/bin/env node
/**
 * Checks the test configuration without running a single test (used by CI):
 * - config/cases.json has a valid test data schema and valid "targets", and
 *   every test case in the code has exactly one entry (and the other way round);
 * - config/descriptions.json has a title and a description for every case in
 *   every language, and placeholders only use the case's own test data;
 * - config/known-bugs.json is well formed: its cases exist and run on the
 *   with-bugs target, its patterns compile, official ids are listed once, and
 *   evidence files exist.
 *
 * Usage: node scripts/check-config.mjs   (npm run check:config)
 */
import { loadCatalog, loadDescriptions, loadKnownBugs } from './lib/catalog.mjs';

try {
  const { config, cases } = loadCatalog();
  loadDescriptions(cases);
  const knownBugs = loadKnownBugs(config);
  const outOfScope = knownBugs.outOfScope?.reduce((sum, group) => sum + group.ids.length, 0) ?? 0;
  console.log(`Config OK: ${cases.length} test cases; test data and descriptions match the test code.`);
  console.log(
    `Known bugs OK: ${knownBugs.bugs.length} official bug(s) targeted, ${knownBugs.unlisted?.length ?? 0} unlisted finding(s), ${outOfScope} out of scope (of ${knownBugs.source.total}).`,
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
