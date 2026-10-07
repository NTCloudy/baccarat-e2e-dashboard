/**
 * Bug detection on the "with-bugs" target (shared/targets.mjs): matches the
 * failures of a run to config/known-bugs.json.
 *
 * Every failed result is classified by its failure messages:
 * - caught:       a message matches a known bug (or an unlisted finding) whose
 *                 `cases` include this case;
 * - blocked:      a message matches a known bug whose `blocks` include this
 *                 case: the bug broke the case's precondition, so the case
 *                 never reached its own checks;
 * - unclassified: any other failure (a new bug, an environment problem or a
 *                 broken test). It needs a human look.
 *
 * Each known bug then gets a status in the run: caught; missed (a detecting
 * case ran but did not catch it: it passed, or failed for another reason);
 * blocked; or not run (skipped, e.g. by the site's bot check, or not
 * selected). The with-bugs verdict is red when an official known bug was
 * missed, when a failure is unclassified or when a round produced no results;
 * "blocked" and "not run" are not red. Unlisted findings are reported but do
 * not change the verdict.
 *
 * Shared by scripts/verdict.mjs (the CI verdict), scripts/lib/catalog.mjs
 * (checks the file for check:config and build-site) and the dashboard
 * (build-site.mjs copies this file to the site as bug-detection.js). No
 * dependencies; runs both in Node.js and in the browser.
 */

export const SEVERITIES = ['high', 'medium', 'low'];
export const BUG_LANGS = ['zh-TW', 'en'];

const CASE_ID = /^TC\d{2}$/;
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EVIDENCE = /^docs\/bugs\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|gif)$/;
const LIMITS = { title: 120, category: 80, reason: 300, match: 300 };
// Playwright reports a test timeout as this line plus the error of the step that was running; on its own it says nothing.
const GENERIC_MESSAGES = [/^(?:Error: )?Test timeout of \d+ms exceeded\.?\s*$/];

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Official bugs are referred to as "#43", unlisted findings by their key. */
export const findingRef = (finding) => (finding?.id !== undefined ? `#${finding.id}` : String(finding?.key ?? ''));

/** URL of an official bug on the list (the list has no per-bug anchors, so this is the list itself). */
export const listUrl = (knownBugs) => knownBugs?.source?.listUrl ?? '';

function toRegExp(source) {
  try {
    return typeof source === 'string' && source ? new RegExp(source) : null;
  } catch {
    return null;
  }
}

/** Known bugs and unlisted findings with their patterns compiled. */
function compileFindings(knownBugs) {
  const entries = [
    ...(knownBugs?.bugs ?? []).map((entry) => ({ kind: 'bug', entry })),
    ...(knownBugs?.unlisted ?? []).map((entry) => ({ kind: 'unlisted', entry })),
  ];
  return entries.map(({ kind, entry }) => ({
    kind,
    entry,
    ref: findingRef(entry),
    cases: Array.isArray(entry.cases) ? entry.cases : [],
    blocks: Array.isArray(entry.blocks) ? entry.blocks : [],
    regex: toRegExp(entry.match),
  }));
}

/** All failure messages of one result (summary.json); older summaries only kept the first one. */
export const messagesOf = (result) => {
  if (Array.isArray(result?.errors) && result.errors.length) return result.errors;
  return result?.error ? [result.error] : [];
};

const EMPTY = Object.freeze({ caught: [], blockedBy: [], unclassified: [] });

/**
 * Classifies one result of one case. Returns `{ status, caught, blockedBy,
 * unclassified }`: status is passed, notRun (skipped or missing), caught,
 * blocked or unclassified; caught and blockedBy hold refs such as "#43";
 * unclassified holds the messages that matched nothing.
 */
function classifyWith(findings, caseId, result) {
  if (!result) return { status: 'notRun', ...EMPTY };
  if (result.status === 'passed') return { status: 'passed', ...EMPTY };
  if (result.status !== 'failed') return { status: 'notRun', ...EMPTY };
  const caught = new Set();
  const blockedBy = new Set();
  const unmatched = [];
  const messages = messagesOf(result);
  for (const message of messages) {
    const hits = findings.filter((f) => f.regex && f.cases.includes(caseId) && f.regex.test(message));
    const blocks = hits.length ? [] : findings.filter((f) => f.regex && f.blocks.includes(caseId) && f.regex.test(message));
    hits.forEach((f) => caught.add(f.ref));
    blocks.forEach((f) => blockedBy.add(f.ref));
    if (!hits.length && !blocks.length) unmatched.push(message);
  }
  const matchedAny = caught.size + blockedBy.size > 0;
  const unclassified = matchedAny ? unmatched.filter((m) => !GENERIC_MESSAGES.some((re) => re.test(m))) : messages.length ? messages : ['(no error message)'];
  const status = unclassified.length ? 'unclassified' : caught.size ? 'caught' : 'blocked';
  return { status, caught: [...caught], blockedBy: [...blockedBy], unclassified };
}

/** Classifies one result against config/known-bugs.json (used for the badges on a run page). */
export function classifyResult(knownBugs, caseId, result) {
  return classifyWith(compileFindings(knownBugs), caseId, result);
}

const CASE_PRIORITY = ['unclassified', 'caught', 'blocked', 'passed', 'notRun'];
const ROUND_PRIORITY = ['caught', 'missed', 'blocked', 'notRun'];
const RUN_PRIORITY = ['missed', 'caught', 'blocked', 'notRun'];
const pick = (statuses, priority) => priority.find((status) => statuses.includes(status)) ?? priority[priority.length - 1];

/** Status of a finding in one result of one of its detecting cases. */
function statusIn(finding, result) {
  if (!result || result.status === 'notRun') return 'notRun';
  if (result.caught.includes(finding.ref)) return 'caught';
  if (result.blockedBy.length) return 'blocked';
  return 'missed'; // the case ran: it passed, or failed for another reason
}

/**
 * Classifies a whole run (summary.json). Returns:
 * - ok: the with-bugs verdict (no missed official bug, no unclassified
 *   failure, no round without results);
 * - bugs / unlisted: every known bug and unlisted finding with its `status`
 *   (caught, missed, blocked, notRun) and per-round statuses;
 * - cases: per case id, its overall `status` (unclassified, caught, blocked,
 *   passed, notRun), the refs it caught or was blocked by, the refs it is
 *   expected to catch, and the per-round classification;
 * - unclassified: { caseId, round, message } for every unexplained failure;
 * - brokenRounds: rounds that produced no results;
 * - counts: numbers for the headline.
 */
export function classifyRun(summary, knownBugs) {
  const findings = compileFindings(knownBugs);
  const rounds = (summary?.roundSummaries ?? []).map((r) => r.round);
  const cases = {};
  const unclassified = [];
  for (const c of summary?.cases ?? []) {
    const perRound = rounds.map((round) => ({ round, ...classifyWith(findings, c.id, c.results.find((r) => r.round === round)) }));
    for (const r of perRound) for (const message of r.unclassified) unclassified.push({ caseId: c.id, round: r.round, message });
    cases[c.id] = {
      id: c.id,
      status: pick(perRound.map((r) => r.status), CASE_PRIORITY),
      caught: [...new Set(perRound.flatMap((r) => r.caught))],
      blockedBy: [...new Set(perRound.flatMap((r) => r.blockedBy))],
      expected: findings.filter((f) => f.cases.includes(c.id)).map((f) => f.ref),
      rounds: perRound,
    };
  }

  const judge = (finding) => {
    const perRound = rounds.map((round) => {
      const statuses = finding.cases.map((id) => statusIn(finding, cases[id]?.rounds.find((r) => r.round === round)));
      return { round, status: pick(statuses, ROUND_PRIORITY) };
    });
    return {
      ref: finding.ref,
      entry: finding.entry,
      status: perRound.length ? pick(perRound.map((r) => r.status), RUN_PRIORITY) : 'notRun',
      rounds: perRound,
    };
  };
  const bugs = findings.filter((f) => f.kind === 'bug').map(judge);
  const unlisted = findings.filter((f) => f.kind === 'unlisted').map(judge);
  const brokenRounds = (summary?.roundSummaries ?? []).filter((r) => r.passed + r.failed + r.skipped === 0).map((r) => r.round);

  const count = (list, status) => list.filter((item) => item.status === status).length;
  const outOfScope = (knownBugs?.outOfScope ?? []).reduce((sum, group) => sum + (group.ids?.length ?? 0), 0);
  const total = knownBugs?.source?.total ?? 0;
  const counts = {
    total,
    inScope: bugs.length,
    caught: count(bugs, 'caught'),
    missed: count(bugs, 'missed'),
    blocked: count(bugs, 'blocked'),
    notRun: count(bugs, 'notRun'),
    unlisted: unlisted.length,
    unlistedCaught: count(unlisted, 'caught'),
    outOfScope,
    outOfScopeGroups: knownBugs?.outOfScope?.length ?? 0,
    notCovered: Math.max(0, total - bugs.length - outOfScope),
    blockedCases: Object.values(cases).filter((c) => c.status === 'blocked').length,
    unclassifiedCases: new Set(unclassified.map((u) => u.caseId)).size,
  };
  return { ok: counts.missed === 0 && unclassified.length === 0 && brokenRounds.length === 0, bugs, unlisted, cases, unclassified, brokenRounds, counts };
}

// ---------------------------------------------------------------- checks for config/known-bugs.json

function checkLocalized(value, limit, where, field) {
  if (!isPlainObject(value)) return [{ code: 'notLocalized', where, field }];
  return BUG_LANGS.flatMap((lang) => {
    const text = value[lang];
    if (typeof text !== 'string' || !text.trim()) return [{ code: 'missingText', where, field, value: lang }];
    if (text.length > limit) return [{ code: 'textTooLong', where, field, value: lang, limit }];
    return [];
  });
}

function checkKeys(value, allowed, where) {
  return Object.keys(value)
    .filter((key) => key !== '$comment' && !allowed.includes(key))
    .map((key) => ({ code: 'unknownField', where, field: key.slice(0, 40) }));
}

function checkCaseList(list, where, field, options, { required }) {
  if (list === undefined && !required) return [];
  if (!Array.isArray(list) || (required && !list.length) || new Set(list).size !== list.length) return [{ code: 'badCaseList', where, field }];
  return list.flatMap((id) => {
    if (typeof id !== 'string' || !CASE_ID.test(id)) return [{ code: 'badCaseList', where, field }];
    if (options.cases && !options.cases.includes(id)) return [{ code: 'unknownCase', where, field, value: id }];
    if (options.runnable && !options.runnable.includes(id)) return [{ code: 'caseNotRunnable', where, field, value: id }];
    return [];
  });
}

function checkFinding(entry, where, kind, options) {
  if (!isPlainObject(entry)) return [{ code: 'notObject', where }];
  const idField = kind === 'bug' ? 'id' : 'key';
  const errors = checkKeys(entry, [idField, 'severity', 'title', 'cases', 'match', 'blocks', 'issue', 'evidence'], where);
  if (kind === 'bug' && !(Number.isInteger(entry.id) && entry.id >= 1 && entry.id <= (options.total ?? Infinity))) {
    errors.push({ code: 'badId', where, field: 'id', value: String(entry.id).slice(0, 20) });
  }
  if (kind === 'unlisted' && !(typeof entry.key === 'string' && KEY.test(entry.key))) errors.push({ code: 'badKey', where, field: 'key' });
  if (!SEVERITIES.includes(entry.severity)) errors.push({ code: 'badSeverity', where, field: 'severity' });
  errors.push(...checkLocalized(entry.title, LIMITS.title, where, 'title'));
  errors.push(...checkCaseList(entry.cases, where, 'cases', options, { required: true }));
  if (typeof entry.match !== 'string' || !entry.match || entry.match.length > LIMITS.match) {
    errors.push({ code: 'badMatch', where, field: 'match', limit: LIMITS.match });
  } else {
    try {
      new RegExp(entry.match);
    } catch (error) {
      errors.push({ code: 'badRegExp', where, field: 'match', detail: String(error.message).slice(0, 120) });
    }
  }
  errors.push(...checkCaseList(entry.blocks, where, 'blocks', options, { required: false }));
  if (Array.isArray(entry.blocks) && Array.isArray(entry.cases)) {
    for (const id of entry.blocks.filter((x) => entry.cases.includes(x))) errors.push({ code: 'blocksOwnCase', where, field: 'blocks', value: id });
  }
  if (!Object.hasOwn(entry, 'issue') || !(entry.issue === null || (Number.isInteger(entry.issue) && entry.issue >= 1))) {
    errors.push({ code: 'badIssue', where, field: 'issue' });
  }
  if (entry.evidence !== undefined) {
    if (typeof entry.evidence !== 'string' || !EVIDENCE.test(entry.evidence)) errors.push({ code: 'badEvidence', where, field: 'evidence' });
    else if (options.evidenceExists && !options.evidenceExists(entry.evidence)) errors.push({ code: 'evidenceMissing', where, field: 'evidence', value: entry.evidence });
  }
  return errors;
}

/**
 * Checks config/known-bugs.json. `options.cases` (all case ids) and
 * `options.runnable` (the ids that run on the with-bugs target) check the case
 * references; `options.evidenceExists(path)` checks evidence files. Returns a
 * list of problems with a `code` (describeBugError gives English).
 */
export function checkKnownBugs(knownBugs, options = {}) {
  if (!isPlainObject(knownBugs)) return [{ code: 'notObject', where: 'config/known-bugs.json' }];
  const errors = checkKeys(knownBugs, ['source', 'bugs', 'unlisted', 'outOfScope'], 'config/known-bugs.json');
  const source = knownBugs.source;
  const total = Number.isInteger(source?.total) && source.total >= 1 ? source.total : null;
  if (!isPlainObject(source)) errors.push({ code: 'notObject', where: 'source' });
  else {
    errors.push(...checkKeys(source, ['listUrl', 'total'], 'source'));
    if (typeof source.listUrl !== 'string' || !/^https:\/\/\S+$/.test(source.listUrl)) errors.push({ code: 'badUrl', where: 'source', field: 'listUrl' });
    if (total === null) errors.push({ code: 'badTotal', where: 'source', field: 'total' });
  }
  const opts = { ...options, total: total ?? Infinity };

  const lists = { bugs: knownBugs.bugs, unlisted: knownBugs.unlisted ?? [], outOfScope: knownBugs.outOfScope ?? [] };
  for (const [name, list] of Object.entries(lists)) if (!Array.isArray(list)) errors.push({ code: 'notList', where: name });

  const bugIds = new Set();
  (Array.isArray(lists.bugs) ? lists.bugs : []).forEach((entry, i) => {
    const where = `bugs[${i}]${Number.isInteger(entry?.id) ? ` (#${entry.id})` : ''}`;
    errors.push(...checkFinding(entry, where, 'bug', opts));
    if (Number.isInteger(entry?.id)) {
      if (bugIds.has(entry.id)) errors.push({ code: 'duplicateId', where, value: `#${entry.id}` });
      bugIds.add(entry.id);
    }
  });
  const keys = new Set();
  (Array.isArray(lists.unlisted) ? lists.unlisted : []).forEach((entry, i) => {
    const where = `unlisted[${i}]${typeof entry?.key === 'string' ? ` (${entry.key.slice(0, 40)})` : ''}`;
    errors.push(...checkFinding(entry, where, 'unlisted', opts));
    if (typeof entry?.key === 'string') {
      if (keys.has(entry.key)) errors.push({ code: 'duplicateKey', where, value: entry.key });
      keys.add(entry.key);
    }
  });
  const grouped = new Set();
  (Array.isArray(lists.outOfScope) ? lists.outOfScope : []).forEach((group, i) => {
    const where = `outOfScope[${i}]`;
    if (!isPlainObject(group)) return errors.push({ code: 'notObject', where });
    errors.push(...checkKeys(group, ['ids', 'category', 'reason'], where));
    errors.push(...checkLocalized(group.category, LIMITS.category, where, 'category'));
    errors.push(...checkLocalized(group.reason, LIMITS.reason, where, 'reason'));
    if (!Array.isArray(group.ids) || !group.ids.length) return errors.push({ code: 'badIds', where, field: 'ids' });
    for (const id of group.ids) {
      if (!Number.isInteger(id) || id < 1 || id > opts.total) errors.push({ code: 'badId', where, field: 'ids', value: String(id).slice(0, 20) });
      else if (bugIds.has(id)) errors.push({ code: 'idInBugs', where, field: 'ids', value: `#${id}` });
      else if (grouped.has(id)) errors.push({ code: 'duplicateId', where, field: 'ids', value: `#${id}` });
      grouped.add(id);
    }
  });
  return errors;
}

/** English description of a problem in config/known-bugs.json, for logs and CI. */
export function describeBugError(error) {
  const where = `${error.where}${error.field ? `.${error.field}` : ''}: `;
  const messages = {
    notObject: 'must be an object',
    notList: 'must be a list',
    unknownField: 'is not a known field (check the spelling)',
    notLocalized: `must be an object with a text for each language (${BUG_LANGS.join(', ')})`,
    missingText: `needs a non-empty "${error.value}" text`,
    textTooLong: `the "${error.value}" text must be at most ${error.limit} characters`,
    badUrl: 'must be an https:// URL',
    badTotal: 'must be a whole number of at least 1',
    badId: `"${error.value}" is not an id on the official list (1 to the list's total)`,
    badIds: 'must be a non-empty list of official bug ids',
    badKey: 'must be a lowercase key such as "search-no-results-message"',
    badSeverity: `must be one of ${SEVERITIES.join(', ')}`,
    badCaseList: 'must be a list of different case ids such as ["TC11"]',
    unknownCase: `${error.value} is not a test case in config/cases.json`,
    caseNotRunnable: `${error.value} does not run on the with-bugs target ("targets" in config/cases.json)`,
    badMatch: `must be a non-empty regular expression of at most ${error.limit} characters`,
    badRegExp: `is not a valid regular expression (${error.detail})`,
    blocksOwnCase: `${error.value} is also in "cases"; a case either detects the bug or is blocked by it`,
    badIssue: 'must be a GitHub issue number or null',
    badEvidence: 'must be an image path such as "docs/bugs/43-add-to-cart.png"',
    evidenceMissing: `the file ${error.value} does not exist`,
    duplicateId: `${error.value} is listed twice`,
    duplicateKey: `"${error.value}" is used twice`,
    idInBugs: `${error.value} is in "bugs", so it cannot be out of scope`,
  };
  return where + (messages[error.code] ?? error.code);
}
