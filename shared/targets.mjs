/**
 * The Baccarat table targets the suite can run against ("targets").
 *
 * - production: the clean 8-deck Baccarat table & seamless wallet server. Every test is expected to pass.
 * - with-bugs:  the defect-injected Baccarat mode with 8 real-world iGaming bugs (third-card tableau,
 *               5% commission truncation, Tie push forfeiture, Pair suit check, wallet concurrency race,
 *               idempotency bypass, late bet after close, and biased shoe RNG).
 */

export const DEFAULT_TARGET = 'production';

export const TARGETS = {
  production: {
    baseURL: 'http://localhost:4100',
    apiURL: 'http://localhost:4100',
    injectedBugs: false,
  },
  'with-bugs': {
    baseURL: 'http://localhost:4100',
    apiURL: 'http://localhost:4100',
    injectedBugs: true,
  },
};

export const TARGET_NAMES = Object.keys(TARGETS);

export const isTarget = (name) => typeof name === 'string' && Object.hasOwn(TARGETS, name);

export function resolveTarget(input) {
  const name = String(input ?? '').trim() || DEFAULT_TARGET;
  if (!isTarget(name)) {
    return { error: `unknown target "${name.slice(0, 40)}" (expected one of: ${TARGET_NAMES.join(', ')})` };
  }
  return { name, ...TARGETS[name] };
}

export const targetOf = (run) => (isTarget(run?.target) ? run.target : DEFAULT_TARGET);

export function isFullRun(run) {
  if (run?.selection !== undefined) return run.selection === 'all';
  return run?.caseCount === undefined || run.caseCount === run.catalogSize;
}

export function latestFullRun(runs, target) {
  const full = (runs ?? []).filter(
    (run) => targetOf(run) === target && isFullRun(run) && (run.totals?.total ?? 1) > 0,
  );
  return full.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] ?? null;
}
