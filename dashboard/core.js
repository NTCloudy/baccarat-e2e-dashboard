// Shared state and helpers for the dashboard views (app.js, bugs.js, console.js, editor.js).
import { splitTemplate } from './descriptions.js';
import { LANGUAGES, MODULE_NAMES, STRINGS } from './i18n.js';
import { DEFAULT_TARGET, TARGETS } from './targets.js';

export const REPO = { owner: 'NTCloudy', name: 'baccarat-e2e-dashboard', branch: 'main' };
export const REPO_URL = `https://github.com/${REPO.owner}/${REPO.name}`;
export const WORKFLOW_FILE = 'e2e.yml';
export const WORKFLOW_URL = `${REPO_URL}/actions/workflows/${WORKFLOW_FILE}`;
export const DESCRIPTIONS_PATH = 'config/descriptions.json';
export const DATA_DIR = 'data';
const LANG_KEY = 'e2e-dashboard-lang';

export const state = {
  lang: pickLanguage(),
  runs: null,
  summaries: new Map(),
  /** catalog.json plus `config`, the same data shaped like config/cases.json for case-params.js. `knownBugs`: config/known-bugs.json (null on older deploys). */
  catalog: null,
  /** config/descriptions.json: from catalog.json first, then the latest version from GitHub. */
  descriptions: {},
  openCell: null, // { runId, caseId, round } while the detail dialog is open
  renderToken: 0,
};

// ---------------------------------------------------------------- i18n

/** ?lang= in the URL wins (shared links), then the saved choice, then the browser language. */
function pickLanguage() {
  const codes = LANGUAGES.map((l) => l.code);
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (codes.includes(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (codes.includes(saved)) return saved;
  } catch {
    /* storage can be blocked; fall through */
  }
  const browser = (navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase();
  return browser.startsWith('zh') ? 'zh-TW' : 'en';
}

export function saveLanguage(code) {
  state.lang = code;
  try {
    localStorage.setItem(LANG_KEY, code);
  } catch {
    /* ignore */
  }
}

export const hasString = (key) => key in (STRINGS[state.lang] ?? {}) || key in STRINGS.en;

export function t(key, vars = {}) {
  const value = STRINGS[state.lang]?.[key] ?? STRINGS.en[key] ?? key;
  return typeof value === 'string' ? value.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? '')) : value;
}

/** Picks the current language from a { "zh-TW": …, en: … } object. */
export const localized = (value) =>
  value && typeof value === 'object' ? (value[state.lang] ?? value.en ?? Object.values(value)[0] ?? '') : (value ?? '');

export const moduleName = (m) => MODULE_NAMES[m]?.[state.lang] ?? m;
export const triggerName = (trigger) => t(`trigger_${trigger}`);
export const catalogCase = (id) => state.catalog?.cases.find((c) => c.id === id) ?? null;

/** Text in the current language, then the other language. Empty values are skipped. */
const pickText = (byLang) => byLang?.[state.lang] || byLang?.en || byLang?.['zh-TW'] || '';

/** Title from config/descriptions.json; falls back to the test title in the code (summary or catalog). */
export const caseTitle = (id, fallback) => pickText(state.descriptions?.[id]?.title) || fallback || catalogCase(id)?.title || id;

/** Display text of a parameter value: the option label for selects. */
export function paramText(def, value) {
  const option = def?.type === 'select' ? def.options?.find((o) => o.value === value) : null;
  return option ? localized(option.label) : String(value ?? '');
}

/**
 * A description template with the test data filled in: "{keyword}" becomes
 * the value in `values`, or the default from the catalog. With `html`, the
 * result is escaped HTML with the values emphasized. Unknown names stay as
 * written.
 */
export function fillTemplate(template, defs, values = {}, { html = false } = {}) {
  return splitTemplate(template)
    .map((part) => {
      if (part.text !== undefined) return html ? esc(part.text) : part.text;
      const def = defs?.[part.param];
      if (!def) return html ? esc(`{${part.param}}`) : `{${part.param}}`;
      const value = part.param in values ? values[part.param] : def.default;
      const text = paramText(def, value);
      return html ? `<strong class="param-value">${esc(text)}</strong>` : text;
    })
    .join('');
}

/** The case's description (config/descriptions.json) with its test data filled in. */
export const caseDescription = (id, values = {}, options = {}) =>
  fillTemplate(pickText(state.descriptions?.[id]?.description), catalogCase(id)?.params ?? {}, values, options);

// ---------------------------------------------------------------- formatting

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 24-hour clock: zh-TW's 12-hour format adds day periods such as "清晨".
export const fmtDate = (iso) =>
  new Intl.DateTimeFormat(state.lang, { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(iso));

export const fmtDay = (date) => new Intl.DateTimeFormat(state.lang, { dateStyle: 'medium' }).format(date);

export function fmtDuration(ms) {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return t('durHM', { h, m });
  if (m) return t('durMS', { m, s });
  return t('durS', { s });
}

export const fmtSeconds = (ms) => t('durS', { s: ((ms ?? 0) / 1000).toFixed(1) });

export const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(v === 0 || v === 1 ? 0 : 1)}%`);

export const rateClass = (v) => (v === null || v === undefined ? 'na' : v >= 0.95 ? 'good' : v >= 0.8 ? 'warn' : 'bad');

export const runLabel = (run) => (run.runNumber ? t('runTitle', { n: run.runNumber }) : t('runLocalTitle'));

export const runPath = (runId, rel) => `${DATA_DIR}/runs/${encodeURIComponent(runId)}/${rel}`;

export const sourceUrl = (c) => `${REPO_URL}/blob/${REPO.branch}/${c.file}#L${c.line}`;

export const ICON = { passed: '✓', failed: '✕', skipped: '–', none: '·' };

/** Site URL of a run; summaries and index entries from before targets existed ran on production. */
export const siteUrl = (run, target) => run?.baseURL ?? TARGETS[target]?.baseURL ?? TARGETS[DEFAULT_TARGET].baseURL;

/** Tag with the target's name ("with-bugs"); the tooltip explains what the target is. */
export const targetTag = (target) =>
  `<span class="tag tag-target tag-target-${esc(target)}" title="${esc(t(`targetHint_${target}`))}">${esc(target)}</span>`;

// ---------------------------------------------------------------- storage

const area = (name) => (name === 'session' ? sessionStorage : localStorage);

/** JSON in localStorage/sessionStorage that never throws (storage can be disabled). */
export const store = {
  get(key, where = 'local') {
    try {
      const raw = area(where).getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  },
  set(key, value, where = 'local') {
    try {
      area(where).setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key, where = 'local') {
    try {
      area(where).removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

// ---------------------------------------------------------------- data

export async function getJson(path, { fresh = false } = {}) {
  // GitHub Pages caches files for 10 minutes; a unique query string skips that cache.
  const url = fresh ? `${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}` : path;
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} (${path})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function loadRuns({ fresh = false } = {}) {
  if (fresh) state.runs = null;
  state.runs ??= await getJson(`${DATA_DIR}/runs.json`, { fresh: true });
  return state.runs;
}

export async function loadSummary(id, { fresh = false } = {}) {
  if (fresh || !state.summaries.has(id)) state.summaries.set(id, await getJson(runPath(id, 'summary.json'), { fresh }));
  return state.summaries.get(id);
}

export async function loadCatalog() {
  if (!state.catalog) {
    const catalog = await getJson('catalog.json', { fresh: true });
    // `targets` limits a case to some targets (case-params.js appliesTo); null runs everywhere.
    const cases = Object.fromEntries(catalog.cases.map((c) => [c.id, { params: c.params, rules: c.rules, targets: c.targets ?? undefined }]));
    state.catalog = { ...catalog, knownBugs: catalog.knownBugs ?? null, config: { lists: catalog.lists, cases } };
    state.descriptions = catalog.descriptions ?? {};
  }
  return state.catalog;
}
