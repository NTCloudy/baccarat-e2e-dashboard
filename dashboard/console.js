// "Run tests" page: pick the target site and test cases, adjust their test
// data, edit their titles and descriptions, and start a run on GitHub
// Actions. The run's progress and results are shown on this page.
import { appliesTo, checkValue, resolveCase, resolveRun } from './case-params.js';
import {
  ICON,
  REPO,
  REPO_URL,
  caseTitle,
  esc,
  fmtDay,
  fmtDuration,
  hasString,
  loadSummary,
  localized,
  moduleName,
  paramText,
  pct,
  rateClass,
  sourceUrl,
  state,
  store,
  t,
  targetTag,
} from './core.js';
import { afterEditorRender, configureEditor, refreshDescriptionView, renderDescriptionBlock } from './editor.js';
import { cancelRun, dispatchRun, getJobs, getRun, tokenStore, verifyToken } from './github.js';
import { DEFAULT_TARGET, TARGETS, TARGET_NAMES, isTarget } from './targets.js';

const DRAFT_KEY = 'e2e-console-draft';
const RUN_KEY = 'e2e-console-run';
const MAX_ROUNDS = 10;
const PHASES = ['setup', 'tests', 'publish', 'deploy'];
const EDIT_DEFAULTS_URL = `${REPO_URL}/edit/${REPO.branch}/config/cases.json`;
// Pre-filled "new fine-grained token" form, 90 days: Actions read/write starts
// and follows runs; Contents read/write saves descriptions (optional).
const TOKEN_URL = `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({
  name: 'E2E dashboard',
  description: `Test console of ${REPO.owner}/${REPO.name}: start test runs (Actions) and save test case descriptions (Contents).`,
  target_name: REPO.owner,
  expires_in: '90',
  actions: 'write',
  contents: 'write',
})}`;

/** The console's form state; kept in localStorage so the last choice is remembered. */
const draft = { ready: false, rounds: 3, target: DEFAULT_TARGET, selected: new Set(), values: {}, expanded: new Set() };
const ui = { dispatching: false, barError: null };
/** The run started from this browser (kept in localStorage while it runs and until dismissed). */
const tracker = { run: store.get(RUN_KEY), timer: null };
let onPublished = () => {};

const config = () => state.catalog.config;
const allCases = () => state.catalog.cases;
const findCase = (id) => allCases().find((c) => c.id === id);
/** Whether a case runs on the chosen target ("targets" in config/cases.json, the same rule as CI). */
const applies = (c) => appliesTo(config(), c.id, draft.target);
const applicableCases = () => allCases().filter(applies);
const isBusy = () => Boolean(tracker.run && !tracker.run.done);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- draft

function initDraft() {
  if (draft.ready) return;
  draft.ready = true;
  const saved = store.get(DRAFT_KEY) ?? {};
  const ids = allCases().map((c) => c.id);
  draft.rounds = Number.isInteger(saved.rounds) && saved.rounds >= 1 && saved.rounds <= MAX_ROUNDS ? saved.rounds : 3;
  draft.target = isTarget(saved.target) ? saved.target : DEFAULT_TARGET;
  draft.selected = new Set(Array.isArray(saved.selected) ? saved.selected.filter((id) => ids.includes(id)) : ids);
  for (const c of allCases()) {
    draft.values[c.id] = {};
    for (const [key, def] of Object.entries(c.params)) {
      const value = saved.values?.[c.id]?.[key];
      // A remembered value is only reused while it is still valid for the current config.
      draft.values[c.id][key] = value !== undefined && !checkValue(def, value).error ? value : def.default;
    }
  }
}

function saveDraft() {
  const values = {};
  for (const c of allCases()) {
    for (const [key, def] of Object.entries(c.params)) {
      if (draft.values[c.id][key] !== def.default) (values[c.id] ??= {})[key] = draft.values[c.id][key];
    }
  }
  store.set(DRAFT_KEY, { rounds: draft.rounds, target: draft.target, selected: [...draft.selected], values });
}

const evaluate = (c) => resolveCase(config(), c.id, draft.values[c.id] ?? {});

/**
 * The workflow inputs for the current selection (the same shape the GitHub
 * "Run workflow" form uses). Ticked cases that do not run on the chosen
 * target stay ticked in the draft but are left out.
 */
function buildRequest() {
  const applicable = applicableCases();
  const selected = applicable.filter((c) => draft.selected.has(c.id));
  const params = {};
  let invalid = 0;
  for (const c of selected) {
    const { values, custom, errors } = evaluate(c);
    invalid += errors.length;
    if (custom.length) params[c.id] = Object.fromEntries(custom.map((key) => [key, values[key]]));
  }
  // Empty = every case that applies to the target (scripts/run-rounds.mjs).
  const all = selected.length === applicable.length;
  return {
    selected,
    total: applicable.length,
    invalid,
    customCases: Object.keys(params).length,
    inputs: {
      rounds: String(draft.rounds),
      cases: all ? '' : selected.map((c) => c.id).join(','),
      params: Object.keys(params).length ? JSON.stringify(params) : '',
      target: draft.target,
    },
  };
}

/** About 2 minutes of setup and publishing plus ~4 s per test case per round on a GitHub runner. */
const estimateMinutes = (caseCount, rounds) => Math.max(2, Math.ceil(2 + (rounds * caseCount * 3.75) / 60));

function errorText(error, c) {
  const key = `err_${error.code}`;
  const other = error.other ? localized(c.params[error.other]?.label) : '';
  return hasString(key) ? t(key, { limit: error.limit, other }) : t('err_generic');
}

function apiErrorText(error) {
  switch (error?.kind) {
    case 'unauthorized':
      return t('apiUnauthorized');
    case 'forbidden':
    case 'notFound':
      return t('apiForbidden');
    case 'rateLimited':
      return t('apiRateLimited');
    case 'rejected':
      return t('apiRejected', { msg: error.message });
    case 'network':
      return t('apiNetwork');
    default:
      return t('apiOther', { status: error?.status || '—', msg: error?.message ?? '' });
  }
}

// ---------------------------------------------------------------- rendering

function groups() {
  const map = new Map();
  for (const c of allCases()) {
    if (!map.has(c.module)) map.set(c.module, []);
    map.get(c.module).push(c);
  }
  return [...map.entries()];
}

/** Page HTML. Call afterConsoleRender() once it is in the document. `focusId` opens that case (#/console/TC04). */
export function renderConsole(focusId = null) {
  initDraft();
  if (focusId && findCase(focusId)) draft.expanded.add(focusId);
  const rounds = Array.from({ length: MAX_ROUNDS }, (_, i) => i + 1)
    .map((n) => `<option value="${n}" ${n === draft.rounds ? 'selected' : ''}>${n}</option>`)
    .join('');
  const targets = TARGET_NAMES.map((name) => `<option value="${esc(name)}" ${name === draft.target ? 'selected' : ''}>${esc(t(`targetOption_${name}`))}</option>`).join('');
  return `
    <div id="console-root">
      <a class="back" href="#/">${esc(t('back'))}</a>
      <section class="hero">
        <h1>${esc(t('consoleTitle'))}</h1>
        <p class="lead">${esc(t('consoleLead'))}</p>
      </section>
      <div id="run-panel">${renderRunPanel()}</div>
      <section class="card console-settings">
        <div class="console-row">
          <div class="console-fields">
            <label class="field-inline" for="c-target">${esc(t('targetLabel'))} <select id="c-target">${targets}</select></label>
            <label class="field-inline" for="c-rounds">${esc(t('roundsLabel'))} <select id="c-rounds">${rounds}</select></label>
          </div>
          <div class="console-row-actions">
            <button type="button" class="btn btn-sm" data-act="select-all">${esc(t('selectAll'))}</button>
            <button type="button" class="btn btn-sm" data-act="select-none">${esc(t('selectNone'))}</button>
            <button type="button" class="btn btn-sm" data-act="reset-all">${esc(t('resetAll'))}</button>
          </div>
        </div>
        <p id="target-note" class="target-note">${renderTargetNote()}</p>
        <div id="token-line" class="token-line">${renderTokenLine()}</div>
      </section>
      <section class="card console-cases">
        ${groups().map(([module, cases]) => renderModule(module, cases)).join('')}
        <p class="muted console-foot">${esc(t('editDefaults'))} <a href="${EDIT_DEFAULTS_URL}" target="_blank" rel="noopener">config/cases.json ↗</a></p>
      </section>
      ${Object.entries(state.catalog.lists ?? {})
        .map(([name, items]) => `<datalist id="list-${esc(name)}">${items.map((item) => `<option value="${esc(item)}"></option>`).join('')}</datalist>`)
        .join('')}
      <div class="console-bar">
        <div id="c-summary" class="console-summary" aria-live="polite"></div>
        <button type="button" class="btn btn-primary btn-run" id="c-run" data-act="run">▶ ${esc(t('run'))}</button>
      </div>
    </div>`;
}

export function afterConsoleRender(focusId = null) {
  refresh();
  afterEditorRender();
  if (tracker.run?.done && tracker.run.outcome === 'published') ensureSummary(tracker.run);
  if (focusId) document.querySelector(`[data-case-item="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'center' });
}

function renderModule(module, cases) {
  return `
    <div class="module-block">
      <div class="module-head">
        <label class="check">
          <input type="checkbox" data-act="toggle-module" data-module="${esc(module)}">
          <span class="module-name">${esc(moduleName(module))}</span>
        </label>
        <span class="muted" data-module-count="${esc(module)}"></span>
      </div>
      <ul class="case-list">${cases.map(renderCaseItem).join('')}</ul>
    </div>`;
}

function renderCaseItem(c) {
  const open = draft.expanded.has(c.id);
  const params = Object.entries(c.params);
  const ok = applies(c);
  const only = Array.isArray(c.targets)
    ? `<span class="tag tag-target-only" id="target-tag-${esc(c.id)}" title="${esc(t('targetOnlyHint'))}">${esc(t('targetOnly', { targets: c.targets.join(', ') }))}</span>`
    : '';
  return `
    <li class="case-item${open ? ' open' : ''}${ok ? '' : ' case-na'}" data-case-item="${esc(c.id)}">
      <div class="case-line">
        <label class="check case-check">
          <input type="checkbox" data-act="toggle-case" data-case="${esc(c.id)}" ${ok && draft.selected.has(c.id) ? 'checked' : ''} ${ok ? '' : 'disabled'}${only ? ` aria-describedby="target-tag-${esc(c.id)}"` : ''}>
          <span class="case-id">${esc(c.id)}</span>
          <span class="case-name" data-case-name="${esc(c.id)}">${esc(caseTitle(c.id, c.title))}</span>
        </label>
        ${only}
        <span class="tag tag-custom" data-custom-tag="${esc(c.id)}" title="${esc(t('customHint'))}" hidden>${esc(t('custom'))}</span>
        <span class="tag tag-bad" data-error-tag="${esc(c.id)}" hidden>${esc(t('needsFix'))}</span>
        <button type="button" class="btn-link case-toggle" data-act="expand" data-case="${esc(c.id)}" aria-expanded="${open}" aria-controls="case-body-${esc(c.id)}">
          ${esc(t('details'))} <span aria-hidden="true">${open ? '▴' : '▾'}</span>
        </button>
      </div>
      <div class="case-body" id="case-body-${esc(c.id)}" ${open ? '' : 'hidden'}>
        ${renderDescriptionBlock(c)}
        <div class="desc-label">${esc(t('testData'))}</div>
        ${
          params.length
            ? `<div class="param-grid">${params.map(([key, def]) => renderParam(c, key, def)).join('')}</div>`
            : `<p class="muted no-params">${esc(t('noParams'))}</p>`
        }
        <div class="case-actions">
          ${params.length ? `<button type="button" class="btn btn-sm" data-act="reset-case" data-case="${esc(c.id)}">${esc(t('resetCase'))}</button>` : ''}
          <a href="${esc(sourceUrl(c))}" target="_blank" rel="noopener">${esc(t('viewCode'))} ↗</a>
        </div>
      </div>
    </li>`;
}

configureEditor({
  valuesOf: (id) => (findCase(id) ? evaluate(findCase(id)).values : {}),
  openTokenDialog: () => openTokenDialog(),
  // A saved title shows up in the case list right away.
  onClosed: (id) => {
    const name = id ? document.querySelector(`[data-case-name="${CSS.escape(id)}"]`) : null;
    if (name) name.textContent = caseTitle(id, findCase(id)?.title);
  },
});

function renderParam(c, key, def) {
  const id = `p-${c.id}-${key}`;
  const value = draft.values[c.id][key];
  const attrs = `id="${esc(id)}" data-param data-case="${esc(c.id)}" data-key="${esc(key)}" aria-describedby="${esc(id)}-help ${esc(id)}-error"`;
  let control;
  if (def.type === 'select') {
    const options = def.options.map((o) => `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(localized(o.label))}</option>`);
    control = `<select ${attrs}>${options.join('')}</select>`;
  } else if (def.type === 'integer') {
    control = `<input ${attrs} type="number" inputmode="numeric" step="1" min="${esc(def.min)}" max="${esc(def.max)}" value="${esc(value)}">`;
  } else {
    const list = def.suggestions ? ` list="list-${esc(def.suggestions)}"` : '';
    control = `<input ${attrs} type="text" maxlength="${esc(def.maxLength ?? 60)}" autocomplete="off" spellcheck="false"${list} value="${esc(value)}">`;
  }
  const help = [
    t('defaultIs', { value: paramText(def, def.default) }),
    def.type === 'integer' ? t('rangeIs', { min: def.min, max: def.max }) : '',
    localized(def.hint),
  ].filter(Boolean);
  return `
    <div class="param">
      <label for="${esc(id)}">${esc(localized(def.label))}</label>
      <div class="param-control">
        ${control}
        <button type="button" class="btn-link" data-act="reset-param" data-case="${esc(c.id)}" data-key="${esc(key)}" hidden>${esc(t('resetParam'))}</button>
      </div>
      <small class="muted" id="${esc(id)}-help">${esc(help.join(' · '))}</small>
      <small class="param-warn" id="${esc(id)}-warn" hidden></small>
      <small class="param-error" id="${esc(id)}-error" hidden></small>
    </div>`;
}

function renderTokenLine() {
  const entry = tokenStore.get();
  if (!entry?.token) {
    return `<span>🔒 ${esc(t('tokenMissing'))}</span>
      <button type="button" class="btn btn-sm" data-act="token-setup">${esc(t('tokenSetup'))}</button>`;
  }
  const parts = [t('tokenReady', { login: entry.login || '—' })];
  const expires = parseExpiry(entry.expires);
  if (expires) parts.push(t('tokenExpires', { date: fmtDay(expires) }));
  const soon = expires && expires.getTime() - Date.now() < 7 * 24 * 3600 * 1000;
  const otherUser = entry.login && entry.login.toLowerCase() !== REPO.owner.toLowerCase();
  return `<span class="ok" aria-hidden="true">✓</span> <span>${esc(parts.join(' · '))}</span>
    ${soon ? `<span class="tag tag-warn">${esc(t('tokenExpiringSoon'))}</span>` : ''}
    ${otherUser ? `<span class="tag tag-warn">${esc(t('tokenOtherUser', { login: entry.login }))}</span>` : ''}
    <span class="muted">· ${esc(tokenStore.remembered() ? t('tokenStoredLocal') : t('tokenStoredSession'))}</span>
    <button type="button" class="btn btn-sm" data-act="token-setup">${esc(t('tokenChange'))}</button>
    <button type="button" class="btn btn-sm" data-act="token-remove">${esc(t('tokenRemove'))}</button>`;
}

/** What the chosen target is, plus how many cases do not apply to it (their checkboxes are disabled). */
function renderTargetNote() {
  const notApplicable = allCases().length - applicableCases().length;
  const total = state.catalog.knownBugs?.source?.total ?? '';
  const parts = [`<span>${esc(t(`targetNote_${draft.target}`, { total }))}</span>`];
  if (TARGETS[draft.target]?.injectedBugs) parts.push(`<a href="#/bugs">${esc(t('navBugs'))} →</a>`);
  if (notApplicable) parts.push(`<span class="target-note-na">${esc(t('targetDisabled', { n: notApplicable, target: draft.target }))}</span>`);
  return parts.join(' ');
}

/** GitHub sends e.g. "2026-12-31 08:00:00 UTC". */
function parseExpiry(raw) {
  if (!raw) return null;
  const iso = String(raw).trim().replace(' ', 'T').replace(/\s*UTC$/, 'Z').replace(/\s*([+-]\d{2})(\d{2})$/, '$1:$2');
  const date = new Date(Number.isNaN(Date.parse(raw)) ? iso : raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---------------------------------------------------------------- partial updates (keep focus while typing)

function refresh() {
  if (!document.getElementById('console-root')) return;
  allCases().forEach(refreshCase);
  refreshTarget();
  refreshSelection();
  refreshBar();
}

/** Disables the cases that do not run on the chosen target and updates the note under the target selector. */
function refreshTarget() {
  const note = document.getElementById('target-note');
  if (note) note.innerHTML = renderTargetNote();
  for (const c of allCases()) {
    const ok = applies(c);
    document.querySelector(`[data-case-item="${CSS.escape(c.id)}"]`)?.classList.toggle('case-na', !ok);
    const box = document.querySelector(`[data-act="toggle-case"][data-case="${CSS.escape(c.id)}"]`);
    if (box) box.disabled = !ok;
  }
}

/** Applies newer titles and descriptions without re-rendering the page (inputs keep their focus). */
export function refreshCaseTexts() {
  if (!document.getElementById('console-root')) return;
  for (const c of allCases()) {
    const name = document.querySelector(`[data-case-name="${c.id}"]`);
    if (name) name.textContent = caseTitle(c.id, c.title);
    refreshDescriptionView(c.id);
  }
}

function refreshCase(c) {
  const { values, custom, errors } = evaluate(c);
  for (const [key, def] of Object.entries(c.params)) {
    const id = `p-${c.id}-${key}`;
    const error = errors.find((e) => e.key === key);
    document.getElementById(id)?.setAttribute('aria-invalid', String(Boolean(error)));
    const errorBox = document.getElementById(`${id}-error`);
    if (errorBox) {
      errorBox.hidden = !error;
      errorBox.textContent = error ? errorText(error, c) : '';
    }
    // Free text is allowed, but a name that is not a known product is likely a typo.
    const list = def.suggestions ? (state.catalog.lists?.[def.suggestions] ?? []) : null;
    const warnBox = document.getElementById(`${id}-warn`);
    if (warnBox) {
      const unknown = Boolean(list && !error && !list.includes(values[key]));
      warnBox.hidden = !unknown;
      warnBox.textContent = unknown ? t('notInList') : '';
    }
    const reset = [...document.querySelectorAll('[data-act="reset-param"]')].find((b) => b.dataset.case === c.id && b.dataset.key === key);
    if (reset) reset.hidden = !custom.includes(key) && !error;
  }
  const customTag = document.querySelector(`[data-custom-tag="${c.id}"]`);
  if (customTag) customTag.hidden = custom.length === 0;
  const errorTag = document.querySelector(`[data-error-tag="${c.id}"]`);
  if (errorTag) errorTag.hidden = errors.length === 0;
  // The description shows the current test data ("搜尋「pliers」…").
  refreshDescriptionView(c.id);
}

function refreshSelection() {
  for (const [module, all] of groups()) {
    // Only the cases that run on the chosen target count (and can be ticked).
    const cases = all.filter(applies);
    const selected = cases.filter((c) => draft.selected.has(c.id)).length;
    const box = [...document.querySelectorAll('[data-act="toggle-module"]')].find((b) => b.dataset.module === module);
    if (box) {
      box.disabled = cases.length === 0;
      box.checked = cases.length > 0 && selected === cases.length;
      box.indeterminate = selected > 0 && selected < cases.length;
    }
    const count = [...document.querySelectorAll('[data-module-count]')].find((el) => el.dataset.moduleCount === module);
    if (count) count.textContent = t('moduleCount', { n: selected, total: cases.length });
  }
  for (const box of document.querySelectorAll('[data-act="toggle-case"]')) {
    const c = findCase(box.dataset.case);
    box.checked = Boolean(c && applies(c) && draft.selected.has(c.id));
  }
}

function refreshBar() {
  const summary = document.getElementById('c-summary');
  const button = document.getElementById('c-run');
  if (!summary || !button) return;
  const request = buildRequest();
  let blocker = null;
  if (!request.selected.length) blocker = t('needCases');
  else if (request.invalid) blocker = t('needFix', { n: request.invalid });
  else if (isBusy()) blocker = t('runBusy');
  const info = [
    t('runSummary', {
      cases: request.selected.length,
      total: request.total,
      rounds: draft.rounds,
      min: estimateMinutes(request.selected.length, draft.rounds),
    }),
    t('summaryTarget', { target: draft.target }),
    request.customCases ? t('customSummary', { n: request.customCases }) : '',
    tokenStore.get()?.token ? '' : t('needTokenShort'),
  ].filter(Boolean);
  if (ui.barError) summary.innerHTML = `<span class="ko">${esc(ui.barError)}</span>`;
  else if (blocker) summary.innerHTML = `<span class="${blocker === t('runBusy') ? 'muted' : 'ko'}">${esc(blocker)}</span>`;
  else summary.textContent = info.join(' · ');
  button.disabled = Boolean(blocker) || ui.dispatching;
  button.textContent = ui.dispatching ? t('runStarting') : `▶ ${t('run')}`;
}

function setInputValue(c, key, value) {
  draft.values[c.id][key] = value;
  const input = document.getElementById(`p-${c.id}-${key}`);
  if (input) input.value = String(value);
}

// ---------------------------------------------------------------- token

function openTokenDialog() {
  const dialog = document.getElementById('token-dialog');
  dialog.innerHTML = `
    <form class="dialog-inner" id="token-form" novalidate>
      <header class="dialog-head">
        <h3>${esc(t('tokenDialogTitle'))}</h3>
        <button type="button" class="btn-close" data-act="token-cancel" aria-label="${esc(t('close'))}">✕</button>
      </header>
      <p>${esc(t('tokenIntro'))}</p>
      <ol class="token-steps">
        <li><a href="${esc(TOKEN_URL)}" target="_blank" rel="noopener">${esc(t('tokenStep1'))} ↗</a></li>
        <li>${esc(t('tokenStep2', { repo: REPO.name }))}</li>
        <li>${esc(t('tokenStep3'))}</li>
        <li>${esc(t('tokenStep4'))}</li>
      </ol>
      <p class="muted small">${esc(t('tokenPermissions'))}</p>
      <label class="field-label" for="token-input">${esc(t('tokenLabel'))}</label>
      <input id="token-input" class="token-input" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…">
      <label class="check token-remember"><input type="checkbox" id="token-remember"> ${esc(t('tokenRemember'))}</label>
      <p class="muted small">${esc(t('tokenRememberHint'))}</p>
      <p class="muted small">${esc(t('tokenSafety'))}</p>
      <p class="param-error" id="token-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="submit" class="btn btn-primary" id="token-save">${esc(t('tokenSave'))}</button>
        <button type="button" class="btn" data-act="token-cancel">${esc(t('cancel'))}</button>
      </div>
    </form>`;
  if (!dialog.open) dialog.showModal();
  document.getElementById('token-input').focus();
}

function closeTokenDialog() {
  const dialog = document.getElementById('token-dialog');
  if (dialog?.open) dialog.close();
}

async function saveToken() {
  const input = document.getElementById('token-input');
  const button = document.getElementById('token-save');
  const errorBox = document.getElementById('token-error');
  const token = input.value.trim();
  const showError = (message) => {
    errorBox.hidden = false;
    errorBox.textContent = message;
  };
  if (!/^(github_pat_|ghp_|gho_)[A-Za-z0-9_]{20,}$/.test(token)) return showError(t('tokenFormat'));
  button.disabled = true;
  button.textContent = t('tokenChecking');
  try {
    const { login, id, expires } = await verifyToken(token);
    tokenStore.save({ token, login, id, expires, savedAt: new Date().toISOString() }, document.getElementById('token-remember').checked);
    closeTokenDialog();
    ui.barError = null;
    const line = document.getElementById('token-line');
    if (line) line.innerHTML = renderTokenLine();
    refreshBar();
  } catch (error) {
    showError(apiErrorText(error));
    button.disabled = false;
    button.textContent = t('tokenSave');
  }
}

function removeToken() {
  tokenStore.clear();
  const line = document.getElementById('token-line');
  if (line) line.innerHTML = renderTokenLine();
  refreshBar();
}

// ---------------------------------------------------------------- run

async function startRun() {
  const request = buildRequest();
  if (!request.selected.length || request.invalid || ui.dispatching || isBusy()) return refreshBar();
  const entry = tokenStore.get();
  if (!entry?.token) return openTokenDialog();
  // The same check CI runs (scripts/run-rounds.mjs), so GitHub never gets a request CI would reject.
  const check = resolveRun(config(), { cases: request.inputs.cases, params: request.inputs.params, target: request.inputs.target });
  if (check.errors.length) {
    ui.barError = t('needFix', { n: check.errors.length });
    return refreshBar();
  }

  ui.dispatching = true;
  ui.barError = null;
  refreshBar();
  try {
    const { id, htmlUrl } = await dispatchRun(entry.token, request.inputs);
    tracker.run = {
      id: String(id),
      htmlUrl,
      runNumber: null,
      dispatchedAt: new Date().toISOString(),
      startedAt: null,
      rounds: draft.rounds,
      target: draft.target,
      caseCount: request.selected.length,
      total: request.total,
      customCases: request.customCases,
      estimate: estimateMinutes(request.selected.length, draft.rounds),
      status: 'queued',
      phase: 'queued',
      done: false,
    };
    persistRun();
    schedulePoll(1500);
  } catch (error) {
    ui.barError = apiErrorText(error);
    if (error.kind === 'unauthorized') removeToken();
  } finally {
    ui.dispatching = false;
    updateRunViews();
  }
  if (tracker.run && !tracker.run.done) document.getElementById('run-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function persistRun() {
  if (tracker.run) store.set(RUN_KEY, tracker.run);
  else store.remove(RUN_KEY);
}

function schedulePoll(delay) {
  clearTimeout(tracker.timer);
  tracker.timer = setTimeout(poll, delay);
}

function phaseOf(info, jobs) {
  if (info.status === 'completed') return 'done';
  const testJob = jobs.find((j) => j.name.startsWith('Run '));
  if (!testJob || ['queued', 'waiting', 'pending', 'requested'].includes(testJob.status)) return info.status === 'in_progress' ? 'setup' : 'queued';
  if (testJob.status !== 'completed') {
    const step = testJob.steps?.find((s) => s.name === 'Run tests');
    if (!step || step.status === 'queued' || step.status === 'pending') return 'setup';
    return step.status === 'in_progress' ? 'tests' : 'publish';
  }
  return 'deploy';
}

async function poll() {
  const run = tracker.run;
  if (!run || run.done) return;
  const token = tokenStore.get()?.token;
  try {
    const info = await getRun(token, run.id);
    // Without a token the API allows 60 requests per hour, so job details are skipped.
    const jobs = token || info.status === 'completed' ? await getJobs(token, run.id) : [];
    Object.assign(run, {
      status: info.status,
      conclusion: info.conclusion,
      runNumber: info.run_number,
      htmlUrl: info.html_url,
      startedAt: info.run_started_at ?? info.created_at,
      phase: phaseOf(info, jobs),
      error: null,
    });
    if (info.status === 'completed') await finish(run, jobs);
  } catch (error) {
    run.error = { kind: error.kind ?? 'other', status: error.status ?? 0, message: String(error.message ?? '') };
  }
  persistRun();
  updateRunViews();
  if (!run.done) schedulePoll(token ? 5000 : 60000);
}

async function finish(run, jobs) {
  run.done = true;
  run.completedAt = new Date().toISOString();
  if (run.conclusion === 'cancelled') {
    run.outcome = 'cancelled';
    return;
  }
  // The workflow is red when a test failed, but results are published as long as these two jobs succeeded.
  const testJob = jobs.find((j) => j.name.startsWith('Run '));
  const deployJob = jobs.find((j) => j.name === 'Deploy dashboard');
  const broken = [testJob, deployJob].find((job) => job?.conclusion !== 'success');
  if (broken !== undefined || !testJob) {
    run.outcome = 'broken';
    run.brokenJob = broken?.name ?? testJob?.name ?? '';
    run.brokenConclusion = broken?.conclusion ?? run.conclusion ?? '';
    return;
  }
  run.outcome = 'published';
  persistRun();
  updateRunViews();
  await loadResult(run);
}

/** The site is redeployed by the run itself; its summary can take a few seconds to appear. */
async function loadResult(run) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const summary = await loadSummary(run.id, { fresh: true });
      const { passRate, passed, failed, skipped } = summary.totals;
      run.result = { passRate, passed, failed, skipped };
      state.runs = null; // the run history now includes this run
      onPublished();
      return;
    } catch {
      await sleep(5000);
    }
  }
  run.resultMissing = true;
}

function ensureSummary(run) {
  if (state.summaries.has(run.id)) return;
  loadSummary(run.id)
    .then(updateRunViews)
    .catch(() => {});
}

async function cancelTrackedRun(button) {
  const token = tokenStore.get()?.token;
  if (!token || !isBusy()) return;
  button.disabled = true;
  button.textContent = t('cancelling');
  try {
    await cancelRun(token, tracker.run.id);
    schedulePoll(2000);
  } catch (error) {
    tracker.run.error = { kind: error.kind ?? 'other', status: error.status ?? 0, message: String(error.message ?? '') };
    updateRunViews();
  }
}

function dismissRun() {
  clearTimeout(tracker.timer);
  tracker.run = null;
  persistRun();
  updateRunViews();
}

function renderRunPanel() {
  const run = tracker.run;
  if (!run) return '';
  const title = run.runNumber ? t('runTitle', { n: run.runNumber }) : t('runThis');
  const scope = t('runScope', { cases: run.caseCount, total: run.total, rounds: run.rounds });
  const target = isTarget(run.target) ? `${targetTag(run.target)} ` : '';
  const log = run.htmlUrl ? `<a class="btn btn-sm" href="${esc(run.htmlUrl)}" target="_blank" rel="noopener">${esc(t('viewLog'))} ↗</a>` : '';
  const warning = run.error ? `<p class="param-warn">${esc(apiErrorText(run.error))}</p>` : '';

  if (!run.done) {
    const current = PHASES.indexOf(run.phase);
    const steps = PHASES.map((phase, i) => {
      const status = run.phase === 'queued' ? 'pending' : i < current ? 'done' : i === current ? 'active' : 'pending';
      return `<li class="phase phase-${status}"><span class="phase-dot" aria-hidden="true">${status === 'done' ? '✓' : i + 1}</span>${esc(t(`phase_${phase}`))}</li>`;
    }).join('');
    const status = run.phase === 'queued' ? t('statusQueued') : t('statusRunning');
    const elapsed = run.startedAt ? fmtDuration(Date.now() - Date.parse(run.startedAt)) : '—';
    return `
      <section class="card run-panel" aria-live="polite">
        <div class="run-panel-head">
          <h2><span class="spinner" aria-hidden="true"></span> ${esc(title)} · ${esc(status)}</h2>
          <span class="muted">${esc(t('elapsed'))} <span data-elapsed>${esc(elapsed)}</span> · ${esc(t('estimate', { min: run.estimate }))}</span>
        </div>
        <p class="muted">${target}${esc(scope)}</p>
        <ol class="phases">${steps}</ol>
        ${warning}
        <div class="run-panel-actions">
          ${log}
          <button type="button" class="btn btn-sm" data-act="run-cancel">${esc(t('cancelRun'))}</button>
        </div>
      </section>`;
  }

  const close = `<button type="button" class="btn-close" data-act="run-dismiss" aria-label="${esc(t('dismiss'))}" title="${esc(t('dismiss'))}">✕</button>`;
  if (run.outcome !== 'published') {
    const message = run.outcome === 'cancelled' ? t('runCancelled') : t('runBroken', { job: run.brokenJob || '—', conclusion: run.brokenConclusion || '—' });
    return `
      <section class="card run-panel run-panel-bad">
        <div class="run-panel-head"><h2>${esc(title)}</h2>${close}</div>
        <p class="${run.outcome === 'cancelled' ? 'muted' : 'ko'}">${esc(message)}</p>
        <div class="run-panel-actions">${log}</div>
      </section>`;
  }

  const result = run.result;
  const summary = state.summaries.get(run.id);
  const body = result
    ? `<div class="run-result">
         <div class="score-value rate-text-${rateClass(result.passRate)}">${pct(result.passRate)}</div>
         <div>
           <div><span class="ok">${esc(t('passed'))} ${result.passed}</span> · <span class="${result.failed ? 'ko' : 'muted'}">${esc(t('failed'))} ${result.failed}</span>${result.skipped ? ` · <span class="muted">${esc(t('skipped'))} ${result.skipped}</span>` : ''}</div>
           <div class="muted">${target}${esc(scope)}</div>
         </div>
       </div>
       ${summary ? `<div class="result-chips">${summary.cases.map((c) => renderChip(run.id, c)).join('')}</div>` : ''}`
    : `<p class="muted">${esc(run.resultMissing ? t('resultsDelayed') : t('waitingResults'))}</p>`;
  return `
    <section class="card run-panel run-panel-done">
      <div class="run-panel-head"><h2>${esc(title)} · ${esc(t('runDone'))}</h2>${close}</div>
      ${body}
      <div class="run-panel-actions">
        <a class="btn btn-primary" href="#/run/${encodeURIComponent(run.id)}">${esc(t('viewResults'))} →</a>
        ${log}
      </div>
    </section>`;
}

function renderChip(runId, c) {
  const cells = c.results.map((r) => `<span class="cell cell-xs cell-${r.status}" aria-hidden="true">${ICON[r.status]}</span>`).join('');
  const label = `${c.id} ${caseTitle(c.id, c.title)} · ${c.results.map((r) => t(r.status)).join(', ')}`;
  return `<a class="chip" href="#/run/${encodeURIComponent(runId)}" title="${esc(label)}" aria-label="${esc(label)}"><span class="case-id">${esc(c.id)}</span>${cells}</a>`;
}

function updateRunViews() {
  const panel = document.getElementById('run-panel');
  if (panel) panel.innerHTML = renderRunPanel();
  syncRunIndicator();
  refreshBar();
}

/** Shows "running" on the header button (app.js renders the header). */
export function syncRunIndicator() {
  const indicator = document.getElementById('run-indicator');
  if (indicator) indicator.hidden = !isBusy();
}

/** Resumes following a run after a reload. `onPublished` runs when new results are on the site. */
export function initTracker(callbacks) {
  onPublished = callbacks.onPublished ?? onPublished;
  if (isBusy()) schedulePoll(0);
  // Keep the elapsed time ticking without re-rendering the panel.
  setInterval(() => {
    const el = document.querySelector('[data-elapsed]');
    if (el && tracker.run?.startedAt) el.textContent = fmtDuration(Date.now() - Date.parse(tracker.run.startedAt));
  }, 1000);
}

/** The run being followed, if any (used by app.js for a not-yet-published run page). */
export const trackedRun = () => tracker.run;

// ---------------------------------------------------------------- events

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  if (target.id === 'token-dialog') return closeTokenDialog(); // backdrop
  const action = target.closest('[data-act]');
  if (!action || !action.closest('#console-root, #token-dialog')) return;
  const c = action.dataset.case ? findCase(action.dataset.case) : null;

  switch (action.dataset.act) {
    case 'select-all':
      applicableCases().forEach((x) => draft.selected.add(x.id));
      break;
    case 'select-none':
      draft.selected.clear();
      break;
    case 'reset-all':
      allCases().forEach((x) => Object.entries(x.params).forEach(([key, def]) => setInputValue(x, key, def.default)));
      break;
    case 'reset-case':
      Object.entries(c.params).forEach(([key, def]) => setInputValue(c, key, def.default));
      break;
    case 'reset-param':
      setInputValue(c, action.dataset.key, c.params[action.dataset.key].default);
      break;
    case 'expand': {
      const open = !draft.expanded.has(c.id);
      if (open) draft.expanded.add(c.id);
      else draft.expanded.delete(c.id);
      document.getElementById(`case-body-${c.id}`).hidden = !open;
      action.closest('.case-item').classList.toggle('open', open);
      action.setAttribute('aria-expanded', String(open));
      action.querySelector('span').textContent = open ? '▴' : '▾';
      return;
    }
    case 'run':
      return void startRun();
    case 'run-cancel':
      return void cancelTrackedRun(action);
    case 'run-dismiss':
      return dismissRun();
    case 'token-setup':
      return openTokenDialog();
    case 'token-remove':
      return removeToken();
    case 'token-cancel':
      return closeTokenDialog();
    default:
      return;
  }
  ui.barError = null;
  saveDraft();
  refresh();
});

document.addEventListener('input', (event) => {
  const input = event.target instanceof Element ? event.target.closest('[data-param]') : null;
  if (!input) return;
  const c = findCase(input.dataset.case);
  draft.values[c.id][input.dataset.key] = input.value;
  ui.barError = null;
  saveDraft();
  refreshCase(c);
  refreshBar();
});

document.addEventListener('change', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !target.closest('#console-root')) return;
  if (target.id === 'c-rounds') {
    draft.rounds = Number(target.value);
  } else if (target.id === 'c-target') {
    if (isTarget(target.value)) draft.target = target.value;
  } else if (target.dataset.act === 'toggle-case') {
    if (target.checked) draft.selected.add(target.dataset.case);
    else draft.selected.delete(target.dataset.case);
  } else if (target.dataset.act === 'toggle-module') {
    const module = target.dataset.module;
    for (const c of allCases().filter((x) => x.module === module && applies(x))) {
      if (target.checked) draft.selected.add(c.id);
      else draft.selected.delete(c.id);
    }
  } else if (target.matches('[data-param]')) {
    // Fix the letter case of a known product name ("claw hammer" -> "Claw Hammer").
    const c = findCase(target.dataset.case);
    const def = c.params[target.dataset.key];
    const list = def.suggestions ? (state.catalog.lists?.[def.suggestions] ?? []) : [];
    const typed = target.value.trim().replace(/\s+/g, ' ').toLowerCase();
    const known = list.find((item) => item.toLowerCase() === typed);
    if (known) setInputValue(c, target.dataset.key, known);
  } else {
    return;
  }
  ui.barError = null;
  saveDraft();
  refresh();
});

document.addEventListener('submit', (event) => {
  if (event.target instanceof Element && event.target.id === 'token-form') {
    event.preventDefault();
    void saveToken();
  }
});
