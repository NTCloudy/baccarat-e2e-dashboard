/**
 * Test data ("parameters") of the test cases: validation and merging rules.
 *
 * The schema and the default values live in config/cases.json. This module is
 * shared by the tests (src/support/testData.ts), the CI runner
 * (scripts/run-rounds.mjs) and the dashboard's test console, so a value that
 * is accepted in the browser is accepted in CI, and vice versa. It has no
 * dependencies and runs both in Node.js and in the browser.
 *
 * Problems are returned as plain objects with a `code`, so every caller can
 * word them in its own language; describeError() gives the English text used
 * in logs.
 */

export const CASE_ID = /^TC\d{2}$/;

/** Letters (any language), digits, spaces and the punctuation used in product names. */
export const TEXT_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .,'&()/+-]*$/u;

export const LIMITS = { textLength: 60, paramsJson: 4000 };

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Case ids in config order. */
export function caseIds(config) {
  return Object.keys(config.cases);
}

/**
 * Whether a case runs on a target (shared/targets.mjs). A case without
 * "targets" runs everywhere; `"targets": ["with-bugs"]` limits it to that
 * target. Without a target (`null`), every case applies.
 */
export function appliesTo(config, caseId, target) {
  const targets = config.cases[caseId]?.targets;
  return !target || !Array.isArray(targets) || targets.includes(target);
}

/** Ids of the cases that run on a target, in config order. */
export function applicableCases(config, target) {
  return caseIds(config).filter((id) => appliesTo(config, id, target));
}

/** [key, definition] pairs of a case, in config order. */
export function paramEntries(config, caseId) {
  return Object.entries(config.cases[caseId]?.params ?? {});
}

export function defaultValues(config, caseId) {
  return Object.fromEntries(paramEntries(config, caseId).map(([key, def]) => [key, def.default]));
}

/**
 * Parses a case selection such as "TC04, tc12". An empty string or "all"
 * selects every case and returns `cases: null`.
 */
export function parseCaseList(config, input) {
  const text = String(input ?? '').trim();
  if (text === '' || text.toLowerCase() === 'all') return { cases: null, errors: [] };
  const known = caseIds(config);
  const picked = new Set();
  const errors = [];
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const id = part.toUpperCase();
    if (!CASE_ID.test(id)) errors.push({ code: 'badCaseId', value: part.slice(0, 40) });
    else if (!known.includes(id)) errors.push({ code: 'unknownCase', caseId: id });
    else picked.add(id);
  }
  if (!errors.length && picked.size === 0) errors.push({ code: 'noCases' });
  return { cases: known.filter((id) => picked.has(id)), errors };
}

/** Parses the overrides JSON, e.g. {"TC04":{"keyword":"pliers"}}. An empty string means no overrides. */
export function parseOverrides(input) {
  const text = String(input ?? '').trim();
  if (text === '') return { overrides: {}, errors: [] };
  if (text.length > LIMITS.paramsJson) return { overrides: {}, errors: [{ code: 'paramsTooLong', limit: LIMITS.paramsJson }] };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { overrides: {}, errors: [{ code: 'badJson', detail: String(error.message).slice(0, 120) }] };
  }
  if (!isPlainObject(parsed) || !Object.values(parsed).every(isPlainObject)) {
    return { overrides: {}, errors: [{ code: 'badShape' }] };
  }
  return { overrides: parsed, errors: [] };
}

/** Checks one value against its definition. Returns `{ value }` (normalized) or `{ error }`. */
export function checkValue(def, raw) {
  switch (def?.type) {
    case 'text': {
      if (typeof raw !== 'string') return { error: { code: 'notText' } };
      const value = raw.trim().replace(/\s+/g, ' ');
      if (!value) return { error: { code: 'required' } };
      const limit = Math.min(def.maxLength ?? LIMITS.textLength, LIMITS.textLength);
      if (value.length > limit) return { error: { code: 'tooLong', limit } };
      if (!TEXT_PATTERN.test(value)) return { error: { code: 'badChars' } };
      return { value };
    }
    case 'integer': {
      const value = typeof raw === 'string' && /^\s*-?\d{1,6}\s*$/.test(raw) ? Number(raw) : raw;
      if (!Number.isInteger(value)) return { error: { code: 'notInteger' } };
      if (typeof def.min === 'number' && value < def.min) return { error: { code: 'tooSmall', limit: def.min } };
      if (typeof def.max === 'number' && value > def.max) return { error: { code: 'tooLarge', limit: def.max } };
      return { value };
    }
    case 'select': {
      const option = (def.options ?? []).find((o) => o.value === raw);
      return option ? { value: option.value } : { error: { code: 'notOption' } };
    }
    default:
      return { error: { code: 'badType', value: String(def?.type) } };
  }
}

/** Rules across the parameters of one case (config: "rules"). */
function checkRules(config, caseId, values) {
  const errors = [];
  for (const rule of config.cases[caseId]?.rules ?? []) {
    if (rule.type === 'lessThan' && !(values[rule.param] < values[rule.than])) {
      errors.push({ code: 'mustBeLess', caseId, key: rule.param, other: rule.than });
    }
    if (rule.type === 'different') {
      const [first, second] = rule.params;
      if (String(values[first]).toLowerCase() === String(values[second]).toLowerCase()) {
        errors.push({ code: 'mustDiffer', caseId, key: second, other: first });
      }
    }
    // The site refuses a second unit of some products ("You can only have one Thor Hammer in the cart.").
    if (rule.type === 'onePerCart' && values[rule.quantity] > 1) {
      const name = String(values[rule.product]).toLowerCase();
      const limited = (config.lists?.onePerCart ?? []).find((item) => item.toLowerCase() === name);
      if (limited) errors.push({ code: 'onePerCart', caseId, key: rule.product, other: rule.quantity, value: limited });
    }
  }
  return errors;
}

/**
 * Effective values of one case: the defaults merged with `overrides`.
 * `custom` lists the keys whose value differs from the default.
 */
export function resolveCase(config, caseId, overrides = {}) {
  const entry = config.cases[caseId];
  if (!entry) return { values: {}, custom: [], errors: [{ code: 'unknownCase', caseId }] };
  const defs = entry.params ?? {};
  const values = {};
  const custom = [];
  const errors = [];
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(defs, key)) errors.push({ code: 'unknownParam', caseId, key: key.slice(0, 40) });
  }
  for (const [key, def] of Object.entries(defs)) {
    values[key] = def.default;
    if (!Object.hasOwn(overrides, key)) continue;
    const result = checkValue(def, overrides[key]);
    if (result.error) {
      errors.push({ ...result.error, caseId, key });
      continue;
    }
    values[key] = result.value;
    if (result.value !== def.default) custom.push(key);
  }
  if (!errors.length) errors.push(...checkRules(config, caseId, values));
  return { values, custom, errors };
}

/**
 * Validates a whole run request (the `cases`, `params` and `target` workflow
 * inputs). Returns the cases to run, the overrides that differ from the
 * defaults, errors (the run must not start) and warnings (ignored input).
 * Cases that do not apply to `target` are never run, also when every case is
 * selected; `all` is true when every case that applies to the target runs.
 */
export function resolveRun(config, request) {
  const target = request?.target || null;
  const applicable = applicableCases(config, target);
  const selection = parseCaseList(config, request?.cases);
  const parsed = parseOverrides(request?.params);
  const errors = [...selection.errors, ...parsed.errors];
  const warnings = [];
  const leftOut = new Set((selection.cases ?? []).filter((id) => !applicable.includes(id)));
  for (const caseId of leftOut) warnings.push({ code: 'notApplicable', caseId, value: target });
  const cases = (selection.cases ?? applicable).filter((id) => applicable.includes(id));
  if (!errors.length && !cases.length) errors.push({ code: 'noApplicableCases', value: target });
  const params = {};
  for (const [caseId, overrides] of Object.entries(parsed.overrides)) {
    if (!config.cases[caseId]) {
      errors.push({ code: 'unknownCase', caseId: caseId.slice(0, 40) });
      continue;
    }
    if (!applicable.includes(caseId)) {
      if (!leftOut.has(caseId)) warnings.push({ code: 'notApplicable', caseId, value: target });
      continue;
    }
    if (!cases.includes(caseId)) {
      warnings.push({ code: 'notSelected', caseId });
      continue;
    }
    const resolved = resolveCase(config, caseId, overrides);
    errors.push(...resolved.errors);
    if (resolved.custom.length) params[caseId] = Object.fromEntries(resolved.custom.map((key) => [key, resolved.values[key]]));
  }
  return { all: cases.length === applicable.length, cases, params, errors, warnings };
}

/**
 * Checks config/cases.json itself: ids, types, every default against its own
 * rules, and "targets" (names are checked against `options.targets`, the known
 * target names, when given).
 */
export function checkConfig(config, options = {}) {
  if (!isPlainObject(config?.cases)) return [{ code: 'badConfig' }];
  const errors = [];
  for (const caseId of caseIds(config)) {
    if (!CASE_ID.test(caseId)) {
      errors.push({ code: 'badCaseId', value: caseId });
      continue;
    }
    const targets = config.cases[caseId]?.targets;
    if (targets !== undefined) {
      const valid = Array.isArray(targets) && targets.length > 0 && targets.every((t) => typeof t === 'string') && new Set(targets).size === targets.length;
      if (!valid) errors.push({ code: 'badTargets', caseId });
      else if (options.targets) {
        for (const name of targets.filter((t) => !options.targets.includes(t))) errors.push({ code: 'unknownTarget', caseId, value: name.slice(0, 40) });
      }
    }
    for (const [key, def] of paramEntries(config, caseId)) {
      const result = checkValue(def, def.default);
      if (result.error) errors.push({ ...result.error, caseId, key, inDefault: true });
      else if (result.value !== def.default) errors.push({ code: 'defaultNotNormalized', caseId, key });
    }
    errors.push(...checkRules(config, caseId, defaultValues(config, caseId)));
  }
  return errors;
}

/** English description of a problem, for logs and CI annotations. */
export function describeError(error) {
  const where = error.caseId ? `${error.caseId}${error.key ? `.${error.key}` : ''}${error.inDefault ? ' (default in config/cases.json)' : ''}: ` : '';
  const messages = {
    badConfig: 'config/cases.json must contain a "cases" object',
    badCaseId: `"${error.value}" is not a case id (expected something like TC04)`,
    unknownCase: 'there is no such test case',
    noCases: 'no test case was selected',
    paramsTooLong: `the test data JSON is longer than ${error.limit} characters`,
    badJson: `the test data is not valid JSON (${error.detail})`,
    badShape: 'the test data must look like {"TC04": {"keyword": "pliers"}}',
    unknownParam: 'this case has no such parameter',
    notText: 'must be text',
    required: 'must not be empty',
    tooLong: `must be at most ${error.limit} characters`,
    badChars: "may only contain letters, digits, spaces and . , ' & ( ) / + -",
    notInteger: 'must be a whole number',
    tooSmall: `must be at least ${error.limit}`,
    tooLarge: `must be at most ${error.limit}`,
    notOption: 'is not one of the allowed options',
    badType: `has an unsupported type "${error.value}"`,
    mustBeLess: `must be less than "${error.other}"`,
    mustDiffer: `must be different from "${error.other}"`,
    defaultNotNormalized: 'the default must be written without extra spaces',
    notSelected: 'has test data but is not selected, so the data is ignored',
    notApplicable: `does not run on "${error.value}" ("targets" in config/cases.json), so it is left out`,
    noApplicableCases: `none of the selected test cases runs on "${error.value}"`,
    badTargets: '"targets" must be a non-empty list of different target names, e.g. ["with-bugs"]',
    unknownTarget: `"${error.value}" in "targets" is not a known target`,
  };
  return where + (messages[error.code] ?? error.code);
}
