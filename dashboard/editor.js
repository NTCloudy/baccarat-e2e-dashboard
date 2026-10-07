// Title and description editor for the test console, plus the refresh of
// config/descriptions.json from GitHub. A save is a commit to that file made
// with the owner's token, so everyone who opens the dashboard sees the change.
import { buildEntry, checkField, DESCRIPTION_LIMITS, LANGS, normalizeField, serializeDescriptions } from './descriptions.js';
import { DESCRIPTIONS_PATH, caseDescription, catalogCase, esc, fillTemplate, hasString, localized, state, t } from './core.js';
import { getFile, noreplyAuthor, putFile, tokenStore } from './github.js';

const TOKEN_SETTINGS_URL = 'https://github.com/settings/personal-access-tokens';

/** The open editor (one case at a time) and the last save message. */
const editor = { caseId: null, values: null, saving: false, error: null, notice: null, lastField: null };
let hooks = {
  /** Test data values of a case as currently set in the console. */
  valuesOf: () => ({}),
  openTokenDialog: () => {},
  onClosed: () => {},
};

export function configureEditor(options) {
  hooks = { ...hooks, ...options };
}

export const isEditing = () => editor.caseId !== null;

// ---------------------------------------------------------------- loading

async function fetchDescriptions() {
  const token = tokenStore.get()?.token;
  try {
    return await getFile(token, DESCRIPTIONS_PATH);
  } catch (error) {
    // An expired token, or one without the Contents permission, should not hide
    // the descriptions from its owner: the repository is public, so read anonymously.
    if (token && ['unauthorized', 'forbidden', 'notFound'].includes(error.kind)) return getFile(null, DESCRIPTIONS_PATH);
    throw error;
  }
}

/**
 * Loads the latest descriptions from GitHub (catalog.json has the version of
 * the last deploy). Resolves to true when they differ from what is shown.
 */
export async function refreshDescriptions() {
  try {
    const latest = JSON.parse((await fetchDescriptions()).text);
    if (JSON.stringify(latest) === JSON.stringify(state.descriptions)) return false;
    state.descriptions = latest;
    return true;
  } catch {
    return false; // offline or rate limited: keep the deployed version
  }
}

// ---------------------------------------------------------------- rendering

const langOrder = () => [state.lang, ...LANGS.filter((lang) => lang !== state.lang)];
const fieldId = (caseId, field, lang) => `desc-${caseId}-${field}-${lang}`;

function storedValues(caseId) {
  const entry = state.descriptions?.[caseId] ?? {};
  return {
    title: Object.fromEntries(LANGS.map((lang) => [lang, entry.title?.[lang] ?? ''])),
    description: Object.fromEntries(LANGS.map((lang) => [lang, entry.description?.[lang] ?? ''])),
  };
}

/** The description of a case in the console, or the editor when it is open for that case. */
export function renderDescriptionBlock(c) {
  return `<div class="desc-slot" data-desc-slot="${esc(c.id)}">${editor.caseId === c.id ? renderEditor(c) : renderView(c)}</div>`;
}

function renderView(c) {
  const text = caseDescription(c.id, hooks.valuesOf(c.id), { html: true });
  const notice = editor.notice?.caseId === c.id ? renderNotice(editor.notice) : '';
  return `
    <div class="desc-view">
      <div class="desc-label">${esc(t('verifies'))}</div>
      <p class="case-checks" data-checks="${esc(c.id)}">${text || `<span class="muted">${esc(t('noDescription'))}</span>`}</p>
      <button type="button" class="btn-link desc-edit" data-act="edit-desc" data-case="${esc(c.id)}">✎ ${esc(t('editDesc'))}</button>
      ${notice}
    </div>`;
}

function renderNotice(notice) {
  const link = notice.url ? ` <a href="${esc(notice.url)}" target="_blank" rel="noopener">${esc(t('viewCommit'))} ↗</a>` : '';
  return `<p class="save-notice" role="status"><span aria-hidden="true">✓</span> ${esc(notice.text)}${link}</p>`;
}

function renderEditor(c) {
  const params = Object.entries(c.params ?? {});
  const chips = params.length
    ? `${esc(t('placeholdersHint'))} ${params
        .map(([key, def]) => `<button type="button" class="ph-chip" data-act="insert-ph" data-ph="${esc(key)}" title="${esc(localized(def.label))}">{${esc(key)}}</button> <span class="muted">${esc(localized(def.label))}</span>`)
        .join(' · ')}`
    : esc(t('noPlaceholders'));
  const fieldsets = langOrder()
    .map((lang) => {
      const titleId = fieldId(c.id, 'title', lang);
      const descId = fieldId(c.id, 'description', lang);
      return `
        <fieldset class="desc-lang">
          <legend>${esc(t(`lang_${lang}`))}</legend>
          <label for="${titleId}">${esc(t('fieldTitle'))}</label>
          <input id="${titleId}" type="text" maxlength="${DESCRIPTION_LIMITS.title + 20}" autocomplete="off"
                 data-desc-field="title" data-lang="${lang}" value="${esc(editor.values.title[lang])}"
                 placeholder="${esc(t('titleFallback', { title: c.title }))}" aria-describedby="${titleId}-error">
          <small class="param-error" id="${titleId}-error" hidden></small>
          <label for="${descId}">${esc(t('fieldDescription'))}</label>
          <textarea id="${descId}" rows="3" maxlength="${DESCRIPTION_LIMITS.description + 50}"
                    data-desc-field="description" data-lang="${lang}" aria-describedby="${descId}-count ${descId}-error">${esc(editor.values.description[lang])}</textarea>
          <small class="muted desc-count" id="${descId}-count"></small>
          <small class="param-error" id="${descId}-error" hidden></small>
          <div class="desc-preview"><span class="muted">${esc(t('preview'))}：</span><span data-preview="${lang}"></span></div>
        </fieldset>`;
    })
    .join('');
  return `
    <form class="desc-editor" data-desc-form="${esc(c.id)}" novalidate>
      <div class="desc-editor-head">
        <strong>✎ ${esc(t('descEditorTitle', { id: c.id }))}</strong>
        <span class="muted small">${esc(t('codeTitle', { title: `${c.id} ${c.title}` }))}</span>
      </div>
      <div class="desc-grid">${fieldsets}</div>
      <p class="muted small">${chips}</p>
      <p class="param-error" role="alert" data-desc-error ${editor.error ? '' : 'hidden'}>${editor.error ?? ''}</p>
      <div class="desc-actions">
        <button type="submit" class="btn btn-primary btn-sm" data-desc-save ${editor.saving ? 'disabled' : ''}>${esc(editor.saving ? t('saving') : t('save'))}</button>
        <button type="button" class="btn btn-sm" data-act="edit-cancel" ${editor.saving ? 'disabled' : ''}>${esc(t('cancel'))}</button>
        <span class="muted small">${esc(t('descSaveNote'))}</span>
      </div>
    </form>`;
}

/** Re-renders one case's slot and refreshes the editor's live checks. */
function redraw(caseId, { focus = false } = {}) {
  const slot = document.querySelector(`[data-desc-slot="${caseId}"]`);
  const c = catalogCase(caseId);
  if (!slot || !c) return;
  slot.innerHTML = editor.caseId === caseId ? renderEditor(c) : renderView(c);
  if (editor.caseId === caseId) {
    refreshChecks(c);
    if (focus) slot.querySelector('[data-desc-field]')?.focus();
  }
}

/** Updates the counters, previews and error messages without re-rendering (keeps the cursor). */
function refreshChecks(c) {
  const problems = validate(c);
  for (const lang of LANGS) {
    for (const field of ['title', 'description']) {
      const id = fieldId(c.id, field, lang);
      const errors = problems.filter((p) => p.field === field && p.lang === lang);
      const box = document.getElementById(`${id}-error`);
      if (box) {
        box.hidden = errors.length === 0;
        box.textContent = errors.map(errorText).join(' ');
      }
      document.getElementById(id)?.setAttribute('aria-invalid', String(errors.length > 0));
    }
    const descId = fieldId(c.id, 'description', lang);
    const count = document.getElementById(`${descId}-count`);
    if (count) count.textContent = `${normalizeField('description', editor.values.description[lang]).length} / ${DESCRIPTION_LIMITS.description}`;
    const preview = document.querySelector(`[data-desc-form="${c.id}"] [data-preview="${lang}"]`);
    if (preview) {
      const template = normalizeField('description', editor.values.description[lang]);
      preview.innerHTML = template ? fillTemplate(template, c.params, hooks.valuesOf(c.id), { html: true }) : `<span class="muted">${esc(t('noDescription'))}</span>`;
    }
  }
  const save = document.querySelector(`[data-desc-form="${c.id}"] [data-desc-save]`);
  if (save) save.disabled = editor.saving || problems.length > 0;
}

function validate(c) {
  const keys = Object.keys(c.params ?? {});
  return LANGS.flatMap((lang) =>
    ['title', 'description'].flatMap((field) => checkField(field, lang, normalizeField(field, editor.values[field][lang]), keys)),
  );
}

function errorText(error) {
  const key = `descErr_${error.code}`;
  return hasString(key) ? t(key, { limit: error.limit, name: `{${error.value}}` }) : t('err_generic');
}

function saveErrorText(error) {
  const link = `<a href="${TOKEN_SETTINGS_URL}" target="_blank" rel="noopener">${esc(t('editTokenLink'))} ↗</a>`;
  switch (error?.kind) {
    case 'unauthorized':
      return esc(t('apiUnauthorized'));
    case 'forbidden':
    case 'notFound':
      return `${esc(t('descSaveForbidden'))} ${link}`;
    case 'conflict':
      return esc(t('descSaveConflict'));
    case 'rateLimited':
      return esc(t('apiRateLimited'));
    case 'network':
      return esc(t('apiNetwork'));
    default:
      return esc(t('descSaveFailed', { msg: error?.message ?? '' }));
  }
}

// ---------------------------------------------------------------- actions

function open(caseId) {
  if (editor.saving) return;
  const previous = editor.caseId;
  Object.assign(editor, { caseId, values: storedValues(caseId), error: null, notice: null, lastField: null });
  if (previous && previous !== caseId) redraw(previous);
  redraw(caseId, { focus: true });
}

function close() {
  const caseId = editor.caseId;
  Object.assign(editor, { caseId: null, values: null, error: null, lastField: null });
  if (caseId) redraw(caseId);
  hooks.onClosed(caseId);
}

/** Commits the edited entry. Based on the latest file, so edits of other cases are kept. */
async function save(c) {
  if (editor.saving || validate(c).length) return;
  const account = tokenStore.get();
  if (!account?.token) return hooks.openTokenDialog();
  const entry = buildEntry(editor.values);
  editor.saving = true;
  editor.error = null;
  redraw(c.id);
  try {
    let result = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      const { text, sha } = await getFile(account.token, DESCRIPTIONS_PATH);
      const docs = JSON.parse(text);
      if (Object.keys(entry).length) docs[c.id] = entry;
      else delete docs[c.id];
      const next = serializeDescriptions(docs);
      if (next === text) {
        result = { docs, unchanged: true };
        break;
      }
      try {
        const message = `Update the ${c.id} title and description (from the dashboard)`;
        const commit = await putFile(account.token, DESCRIPTIONS_PATH, { text: next, sha, message, author: noreplyAuthor(account) });
        result = { docs, commitUrl: commit.commitUrl };
      } catch (error) {
        // Someone saved in between: retry once on top of their version.
        if (error.kind !== 'conflict' || attempt === 1) throw error;
      }
    }
    state.descriptions = result.docs;
    editor.saving = false;
    editor.notice = { caseId: c.id, text: result.unchanged ? t('descUnchanged') : t('descSaved'), url: result.commitUrl ?? null };
    close();
  } catch (error) {
    editor.saving = false;
    editor.error = saveErrorText(error);
    redraw(c.id);
  }
}

function insertPlaceholder(button) {
  const form = button.closest('[data-desc-form]');
  const target =
    (editor.lastField && form.querySelector(`#${CSS.escape(editor.lastField)}`)) ??
    form.querySelector(`[data-desc-field="description"][data-lang="${state.lang}"]`);
  if (!target || target.dataset.descField !== 'description') return;
  const text = `{${button.dataset.ph}}`;
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  target.setRangeText(text, start, end, 'end');
  target.focus();
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------------------------------------------------------------- events

document.addEventListener('click', (event) => {
  const action = event.target instanceof Element ? event.target.closest('[data-act]') : null;
  if (!action) return;
  switch (action.dataset.act) {
    case 'edit-desc':
      return open(action.dataset.case);
    case 'edit-cancel':
      return close();
    case 'insert-ph':
      return insertPlaceholder(action);
    default:
      return;
  }
});

document.addEventListener('input', (event) => {
  const field = event.target instanceof Element ? event.target.closest('[data-desc-field]') : null;
  if (!field || !editor.caseId) return;
  editor.values[field.dataset.descField][field.dataset.lang] = field.value;
  editor.error = null;
  const errorBox = field.closest('form')?.querySelector('[data-desc-error]');
  if (errorBox) errorBox.hidden = true;
  refreshChecks(catalogCase(editor.caseId));
});

document.addEventListener('focusin', (event) => {
  const field = event.target instanceof Element ? event.target.closest('[data-desc-field="description"]') : null;
  if (field) editor.lastField = field.id;
});

document.addEventListener('submit', (event) => {
  const form = event.target instanceof Element ? event.target.closest('[data-desc-form]') : null;
  if (!form) return;
  event.preventDefault();
  const c = catalogCase(form.dataset.descForm);
  if (c) void save(c);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && editor.caseId && !editor.saving && event.target instanceof Element && event.target.closest('[data-desc-form]')) {
    close();
  }
});

/** Called after the console re-renders: restores the live checks of an open editor. */
export function afterEditorRender() {
  if (editor.caseId) {
    const c = catalogCase(editor.caseId);
    if (c) refreshChecks(c);
  }
}

/** Refreshes a closed description (e.g. after its test data changed in the console). */
export function refreshDescriptionView(caseId) {
  if (editor.caseId !== caseId) {
    const target = document.querySelector(`[data-checks="${caseId}"]`);
    if (target) target.innerHTML = caseDescription(caseId, hooks.valuesOf(caseId), { html: true }) || `<span class="muted">${esc(t('noDescription'))}</span>`;
  } else {
    const c = catalogCase(caseId);
    if (c) refreshChecks(c);
  }
}
