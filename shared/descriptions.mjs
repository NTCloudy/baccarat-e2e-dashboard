/**
 * Titles and descriptions of the test cases (config/descriptions.json).
 *
 * They are documentation only: the dashboard shows them, and the owner can
 * edit them in the dashboard's test console (each save is a commit to the
 * file). The tests never read them. In a description, "{keyword}" shows the
 * value of that test data parameter of the case (config/cases.json).
 *
 * Shared by build-site.mjs (checks the file before publishing) and the
 * dashboard (display, and checks in the editor before saving). No
 * dependencies; runs both in Node.js and in the browser.
 */

export const LANGS = ['zh-TW', 'en'];
export const FIELDS = ['title', 'description'];
export const DESCRIPTION_LIMITS = { title: 80, description: 500 };

const CASE_ID = /^TC\d{2}$/;
const PLACEHOLDER = /\{(\w+)\}/g;
// Control characters other than the newline (allowed in descriptions).
// eslint-disable-next-line no-control-regex -- finding control characters is the point of this pattern
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/;

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parameter names used as {name} in a text, in order of first use. */
export function placeholders(text) {
  return [...new Set([...String(text ?? '').matchAll(PLACEHOLDER)].map((match) => match[1]))];
}

/** Splits a description into plain text and {name} parts, for rendering. */
export function splitTemplate(text) {
  return String(text ?? '')
    .split(/(\{\w+\})/)
    .filter(Boolean)
    .map((part) => {
      const match = /^\{(\w+)\}$/.exec(part);
      return match ? { param: match[1] } : { text: part };
    });
}

/** Titles are one line; descriptions keep single line breaks. Both are trimmed. */
export function normalizeField(field, raw) {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n');
  if (field === 'title') return text.replace(/\s+/g, ' ').trim();
  return text
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Checks one field. Returns a list of problems with a `code`, so every caller
 * can word them in its own language (describeDocError gives English).
 */
export function checkField(field, lang, value, paramKeys) {
  const errors = [];
  if (typeof value !== 'string') return [{ code: 'notText', field, lang }];
  const limit = DESCRIPTION_LIMITS[field];
  if (value.length > limit) errors.push({ code: 'tooLong', field, lang, limit });
  if (CONTROL.test(value) || (field === 'title' && value.includes('\n'))) errors.push({ code: 'controlChars', field, lang });
  if (field === 'description') {
    for (const name of placeholders(value)) {
      if (!paramKeys.includes(name)) errors.push({ code: 'unknownPlaceholder', field, lang, value: name });
    }
  }
  return errors;
}

/**
 * The entry for one case as it should be stored: normalized values, empty
 * values left out (the dashboard then falls back to the other language, and
 * for titles to the test title in the code).
 */
export function buildEntry(values) {
  const entry = {};
  for (const field of FIELDS) {
    for (const lang of LANGS) {
      const value = normalizeField(field, values?.[field]?.[lang]);
      if (value) (entry[field] ??= {})[lang] = value;
    }
  }
  return entry;
}

/** Checks the entry of one case; `paramKeys` are the names of its test data parameters. */
export function checkEntry(entry, paramKeys = []) {
  if (!isPlainObject(entry)) return [{ code: 'badShape' }];
  const errors = [];
  for (const [field, byLang] of Object.entries(entry)) {
    if (!FIELDS.includes(field)) {
      errors.push({ code: 'unknownField', field: field.slice(0, 40) });
      continue;
    }
    if (!isPlainObject(byLang)) {
      errors.push({ code: 'badShape', field });
      continue;
    }
    for (const [lang, value] of Object.entries(byLang)) {
      if (!LANGS.includes(lang)) errors.push({ code: 'unknownLang', field, lang: lang.slice(0, 20) });
      else errors.push(...checkField(field, lang, value, paramKeys));
    }
  }
  return errors;
}

/**
 * Checks the whole file. `paramKeysOf(caseId)` lists a case's parameters.
 * Entries for cases that do not exist are reported as warnings (they are
 * harmless, e.g. right after a test was deleted).
 */
export function checkDescriptions(docs, caseIds, paramKeysOf = () => []) {
  if (!isPlainObject(docs)) return { errors: [{ code: 'badFile' }], warnings: [] };
  const errors = [];
  const warnings = [];
  for (const [key, entry] of Object.entries(docs)) {
    if (key === '$comment') continue;
    if (!CASE_ID.test(key)) {
      errors.push({ code: 'badCaseId', value: key.slice(0, 40) });
      continue;
    }
    if (!caseIds.includes(key)) {
      warnings.push({ code: 'unknownCase', caseId: key });
      continue;
    }
    errors.push(...checkEntry(entry, paramKeysOf(key)).map((error) => ({ ...error, caseId: key })));
  }
  for (const id of caseIds) {
    if (!isPlainObject(docs[id])) warnings.push({ code: 'missingCase', caseId: id });
  }
  return { errors, warnings };
}

/** The file text, formatted exactly like the committed file so a save only changes the edited lines. */
export function serializeDescriptions(docs) {
  return `${JSON.stringify(docs, null, 2)}\n`;
}

/** English description of a problem, for logs. */
export function describeDocError(error) {
  const where = [error.caseId, error.field, error.lang].filter(Boolean).join('.');
  const messages = {
    badFile: 'config/descriptions.json must contain an object',
    badShape: 'must be an object such as {"zh-TW": "…", "en": "…"}',
    badCaseId: `"${error.value}" is not a case id (expected something like TC04)`,
    unknownCase: 'there is no such test case (the entry is ignored)',
    missingCase: 'has no title or description yet (the test title from the code is shown)',
    unknownField: 'only "title" and "description" are supported',
    unknownLang: `the language must be one of ${LANGS.join(', ')}`,
    notText: 'must be text',
    tooLong: `must be at most ${error.limit} characters`,
    controlChars: 'contains control characters (or a line break in a title)',
    unknownPlaceholder: `{${error.value}} is not a test data parameter of this case`,
  };
  return `${where ? `${where}: ` : ''}${messages[error.code] ?? error.code}`;
}
