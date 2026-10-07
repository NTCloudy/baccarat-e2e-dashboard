// "Bug detection" page (#/bugs), plus the bug badges and notes on with-bugs run
// pages and the teaser on the home page. The same suite runs against
// Toolshop's with-bugs release; every failure is matched to
// config/known-bugs.json by bug-detection.js, the same code the CI verdict
// uses (scripts/verdict.mjs), so this page and the workflow always agree.
import { classifyRun, findingRef } from './bug-detection.js';
import {
  ICON,
  REPO_URL,
  caseTitle,
  catalogCase,
  esc,
  fmtDate,
  loadCatalog,
  loadRuns,
  loadSummary,
  localized,
  runLabel,
  state,
  t,
  targetTag,
} from './core.js';
import { DEFAULT_TARGET, TARGET_NAMES, TARGETS, latestFullRun, targetOf } from './targets.js';

/** The target whose failures are judged against the known bugs ("with-bugs"). */
export const BUG_TARGET = TARGET_NAMES.find((name) => TARGETS[name].injectedBugs);

/** Whether a run summary or runs.json entry ran on the with-bugs release. */
export const judgesBugs = (run) => Boolean(TARGETS[targetOf(run)]?.injectedBugs);

/** Classification of a with-bugs run (bug-detection.js classifyRun), or null for production runs and older deploys. */
export function detectionOf(summary) {
  const knownBugs = state.catalog?.knownBugs;
  return judgesBugs(summary) && knownBugs ? classifyRun(summary, knownBugs) : null;
}

const findings = () => [...(state.catalog?.knownBugs?.bugs ?? []), ...(state.catalog?.knownBugs?.unlisted ?? [])];
const isOfficial = (ref) => ref.startsWith('#');
/** "#43 Add to cart shows an error…" for official bugs, the title alone for unlisted findings. */
const refTitle = (ref) => {
  const finding = findings().find((f) => findingRef(f) === ref);
  if (!finding) return ref;
  return isOfficial(ref) ? `${ref} ${localized(finding.title)}` : localized(finding.title);
};
/** Short reference for running text: "#43", or "an unlisted finding". */
const shortRef = (ref) => (isOfficial(ref) ? ref : t('unlistedShort'));
const firstLine = (text) => String(text ?? '').split('\n').find((line) => line.trim()) ?? '';
const clip = (text, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// ---------------------------------------------------------------- badges (run page)

function badge(kind, ref) {
  const text = kind === 'caught' ? (isOfficial(ref) ? t('badgeCaught', { ref }) : t('badgeCaughtUnlisted')) : t('badgeBlocked', { ref });
  return `<span class="bug-badge bug-badge-${kind}" title="${esc(refTitle(ref))}">${esc(text)}</span>`;
}

/**
 * Badges for one classified result, or a whole case (caught and blockedBy are
 * then the union over its rounds): 「抓到 #43」, 「被 #43 阻擋」, 「未歸類」.
 */
export function bugBadges(item) {
  if (!item) return '';
  const badges = [...item.caught.map((ref) => badge('caught', ref)), ...item.blockedBy.map((ref) => badge('blocked', ref))];
  if (item.status === 'unclassified') {
    badges.push(`<span class="bug-badge bug-badge-unclassified" title="${esc(t('unclassifiedHint'))}">${esc(t('badgeUnclassified'))}</span>`);
  }
  return badges.join('');
}

/** Plain-text label of a classified result, for tooltips: "抓到 #43". */
export function bugLabel(item) {
  if (!item || !['caught', 'blocked', 'unclassified'].includes(item.status)) return '';
  if (item.status === 'unclassified') return t('badgeUnclassified');
  if (item.status === 'blocked') return item.blockedBy.map((ref) => t('badgeBlocked', { ref })).join(', ');
  return item.caught.map((ref) => (isOfficial(ref) ? t('badgeCaught', { ref }) : t('badgeCaughtUnlisted'))).join(', ');
}

/** One-line explanation under the head of a with-bugs run page. */
export function renderBugRunNote(detection) {
  const stats = detection
    ? `<p class="muted">${esc(
        t('withBugsStats', {
          caught: detection.counts.caught + detection.counts.unlistedCaught,
          blocked: detection.counts.blockedCases,
          unclassified: detection.counts.unclassifiedCases,
        }),
      )} · <a href="#/bugs">${esc(t('navBugs'))} →</a></p>`
    : '';
  return `
    <section class="card bug-note">
      <p><span aria-hidden="true">🐞</span> ${esc(t('withBugsNote'))}</p>
      ${stats}
    </section>`;
}

/** "Bug detection" section of the detail dialog for a failed result on with-bugs. */
export function renderBugDetail(item) {
  if (!item || !['caught', 'blocked', 'unclassified'].includes(item.status)) return '';
  const list = (kind, refs) => `<ul class="bug-detail-list">${refs.map((ref) => `<li>${badge(kind, ref)} ${esc(refTitle(ref))}</li>`).join('')}</ul>`;
  const parts = [];
  if (item.caught.length) parts.push(`<p>${esc(t('detailCaught'))}</p>${list('caught', item.caught)}`);
  if (item.blockedBy.length) parts.push(`<p>${esc(t('detailBlocked'))}</p>${list('blocked', item.blockedBy)}`);
  if (item.status === 'unclassified') {
    parts.push(`<p><span class="bug-badge bug-badge-unclassified">${esc(t('badgeUnclassified'))}</span> ${esc(t('unclassifiedHint'))}</p>`);
  }
  return `<section class="bug-detail"><h4>${esc(t('detailBugTitle'))}</h4>${parts.join('')}</section>`;
}

// ---------------------------------------------------------------- home teaser

/** Card on the home page that leads to the Bug page; the numbers are filled in by fillBugTeaser(). */
export function renderBugTeaser() {
  const knownBugs = state.catalog?.knownBugs;
  if (!knownBugs) return '';
  return `
    <a class="card bug-teaser" href="#/bugs">
      <span class="bug-teaser-icon" aria-hidden="true">🐞</span>
      <span class="bug-teaser-text">
        <strong>${esc(t('navBugs'))}</strong>
        <span>${esc(t('bugTeaserBody', { total: knownBugs.source.total }))}</span>
        <span class="bug-teaser-stat" data-bug-teaser hidden></span>
      </span>
      <span class="running-banner-link">${esc(t('bugTeaserLink'))} →</span>
    </a>`;
}

/** Adds "latest run: caught 5 of 5" to the teaser once the reference run is loaded. */
export async function fillBugTeaser(runs, isCurrent) {
  const reference = latestFullRun(runs, BUG_TARGET);
  const knownBugs = state.catalog?.knownBugs;
  if (!reference || !knownBugs) return;
  try {
    const summary = await loadSummary(reference.id);
    const element = document.querySelector('[data-bug-teaser]');
    if (!isCurrent() || !element) return;
    const { counts } = classifyRun(summary, knownBugs);
    element.textContent = t('bugTeaserStat', { caught: counts.caught, inScope: counts.inScope, date: fmtDate(reference.startedAt) });
    element.hidden = false;
  } catch {
    /* the teaser works without numbers */
  }
}

// ---------------------------------------------------------------- Bug page

/** Everything the Bug page shows: the known bugs and the latest full run on each target. */
export async function loadBugPage() {
  const [runs, catalog] = await Promise.all([loadRuns(), loadCatalog()]);
  const reference = latestFullRun(runs, BUG_TARGET);
  const productionRef = latestFullRun(runs, DEFAULT_TARGET);
  const [withBugs, production] = await Promise.all([
    reference ? loadSummary(reference.id) : null,
    // The production column is a comparison; the page works without it.
    productionRef ? loadSummary(productionRef.id).catch(() => null) : null,
  ]);
  return { knownBugs: catalog.knownBugs, reference, productionRef, withBugs, production };
}

const pill = (kind, text, hint) => `<span class="pill pill-${kind}"${hint ? ` title="${esc(hint)}"` : ''}>${esc(text)}</span>`;
const runLink = (run) => `<a href="#/run/${encodeURIComponent(run.id)}">${esc(runLabel(run))}</a>`;

/** Whether a case runs on production ("targets" in config/cases.json). */
const runsOnProduction = (id) => {
  const targets = catalogCase(id)?.targets;
  return !Array.isArray(targets) || targets.includes(DEFAULT_TARGET);
};

/** The case's result in the production reference run: "TC11 ✓ 3/3". */
function productionCell(production, caseIds) {
  if (!production) return `<span class="muted">—</span>`;
  return caseIds
    .map((id) => {
      const c = production.cases.find((x) => x.id === id);
      let result;
      if (!c) result = `<span class="muted">${esc(runsOnProduction(id) ? t('notRun') : t('prodNotApplicable'))}</span>`;
      else {
        const executed = c.results.filter((r) => r.status !== 'skipped');
        const passed = executed.filter((r) => r.status === 'passed').length;
        if (!executed.length) result = `<span class="status status-skipped">${ICON.skipped} ${esc(t('skipped'))}</span>`;
        else {
          const ok = passed === executed.length;
          const label = `${t(ok ? 'passed' : 'failed')} ${passed}/${executed.length}`;
          result = `<span class="status status-${ok ? 'passed' : 'failed'}" title="${esc(label)}">${ok ? ICON.passed : ICON.failed} ${passed}/${executed.length}</span>`;
        }
      }
      return `<span class="prod-result"><span class="case-id">${esc(id)}</span>${result}</span>`;
    })
    .join('');
}

function detectingCases(entry, reference) {
  return entry.cases
    .map((id) => {
      const title = caseTitle(id);
      return reference
        ? `<a class="case-id" href="#/run/${encodeURIComponent(reference.id)}" title="${esc(title)}">${esc(id)}</a>`
        : `<span class="case-id" title="${esc(title)}">${esc(id)}</span>`;
    })
    .join(' ');
}

function statusCell(judged, detection) {
  if (!judged) return `<span class="muted">—</span>`;
  if (judged.status === 'blocked') {
    const blockers = [...new Set(judged.entry.cases.flatMap((id) => detection.cases[id]?.blockedBy ?? []))];
    return pill('blocked', t('bugStatusBlockedBy', { refs: blockers.join(', ') }), t('bugStatusHint_blocked'));
  }
  return pill(judged.status, t(`bugStatus_${judged.status}`), t(`bugStatusHint_${judged.status}`));
}

function issueCell(entry) {
  const parts = [];
  if (entry.issue) {
    parts.push(`<a href="${REPO_URL}/issues/${encodeURIComponent(entry.issue)}" target="_blank" rel="noopener">${esc(t('issueLink', { n: entry.issue }))} ↗</a>`);
  }
  if (entry.evidence) {
    const alt = t('evidenceAlt', { ref: refTitle(findingRef(entry)) });
    parts.push(
      `<a class="evidence" href="${esc(entry.evidence)}" target="_blank" rel="noopener" title="${esc(t('evidence'))}"><img class="evidence-thumb" src="${esc(entry.evidence)}" alt="${esc(alt)}" loading="lazy"></a>`,
    );
  }
  return parts.length ? parts.join('') : `<span class="muted">—</span>`;
}

function renderFindingTable(entries, judgedList, { official, detection, reference, production, listUrl }) {
  const judged = (entry) => judgedList?.find((j) => j.ref === findingRef(entry)) ?? null;
  const labels = {
    id: official ? t('colBugId') : t('colKey'),
    title: t('colBugTitle'),
    severity: t('colSeverity'),
    cases: t('colDetectedBy'),
    status: BUG_TARGET,
    production: t('colProduction'),
    issue: t('colIssue'),
  };
  const rows = entries
    .map((entry) => {
      const ref = findingRef(entry);
      const id = official
        ? `<a class="bug-id" href="${esc(listUrl)}" target="_blank" rel="noopener" title="${esc(t('bugOnList', { ref }))}">${esc(ref)}</a>`
        : `<code class="bug-key">${esc(ref)}</code>`;
      return `
        <tr>
          <td data-label="${esc(labels.id)}">${id}</td>
          <td data-label="${esc(labels.title)}" class="wrap">${esc(localized(entry.title))}</td>
          <td data-label="${esc(labels.severity)}"><span class="sev sev-${esc(entry.severity)}">${esc(t(`severity_${entry.severity}`))}</span></td>
          <td data-label="${esc(labels.cases)}">${detectingCases(entry, reference)}</td>
          <td data-label="${esc(labels.status)}">${statusCell(judged(entry), detection)}</td>
          <td data-label="${esc(labels.production)}">${productionCell(production, entry.cases)}</td>
          <td data-label="${esc(labels.issue)}">${issueCell(entry)}</td>
        </tr>`;
    })
    .join('');
  return `
    <div class="table-wrap">
      <table class="table stack-table bug-table">
        <thead><tr>${Object.values(labels)
          .map((label) => `<th scope="col">${esc(label)}</th>`)
          .join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function caseStatusPill(item) {
  const refs = (list) => list.map(shortRef).join(', ');
  switch (item.status) {
    case 'caught':
      return pill('caught', t('caseStatus_caught', { refs: refs(item.caught) }));
    case 'blocked':
      return pill('blocked', t('caseStatus_blocked', { refs: refs(item.blockedBy) }), t('detailBlocked'));
    case 'unclassified':
      return pill('unclassified', t('badgeUnclassified'), t('unclassifiedHint'));
    case 'passed':
      return pill('passed', t('passed'));
    default:
      return pill('notRun', t('notRun'));
  }
}

function caseNote(item, c, detection) {
  if (item.status === 'unclassified') {
    const messages = detection.unclassified.filter((u) => u.caseId === c.id);
    const text = clip(firstLine(messages[0]?.message));
    const more = messages.length > 1 ? ` <span class="muted">${esc(t('moreMessages', { n: messages.length - 1 }))}</span>` : '';
    return `<code class="note-message">${esc(text)}</code>${more}`;
  }
  if (item.status === 'caught') return esc(item.caught.map(refTitle).join('; '));
  if (item.status === 'blocked') return esc(item.blockedBy.map(refTitle).join('; '));
  if (item.status === 'notRun') {
    const skipped = c.results.find((r) => r.status === 'skipped');
    if (skipped?.blocked) return esc(t('blocked'));
    if (skipped?.skipReason) return esc(skipped.skipReason);
  }
  return `<span class="muted">—</span>`;
}

function renderCaseTable(detection, withBugs, production, reference) {
  const labels = { case: t('colCase'), result: t('colResult'), production: t('colProduction'), note: t('colNote') };
  const rows = [...withBugs.cases]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => {
      const item = detection.cases[c.id];
      return `
        <tr>
          <td data-label="${esc(labels.case)}" class="wrap"><a class="case-id" href="#/run/${encodeURIComponent(reference.id)}">${esc(c.id)}</a> ${esc(caseTitle(c.id, c.title))}</td>
          <td data-label="${esc(labels.result)}">${caseStatusPill(item)}</td>
          <td data-label="${esc(labels.production)}">${productionCell(production, [c.id])}</td>
          <td data-label="${esc(labels.note)}" class="wrap note-cell">${caseNote(item, c, detection)}</td>
        </tr>`;
    })
    .join('');
  return `
    <section class="card">
      <div class="section-head"><h2>${esc(t('casesTitle'))}</h2></div>
      <p class="muted section-hint">${esc(t('casesHint'))}</p>
      <div class="table-wrap">
        <table class="table stack-table case-table">
          <thead><tr>${Object.values(labels)
            .map((label) => `<th scope="col">${esc(label)}</th>`)
            .join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

function renderOutOfScope(knownBugs) {
  const groups = knownBugs.outOfScope ?? [];
  const covered = new Set([...knownBugs.bugs.map((b) => b.id), ...groups.flatMap((g) => g.ids)]);
  const uncovered = Array.from({ length: knownBugs.source.total }, (_, i) => i + 1).filter((id) => !covered.has(id));
  const ids = (list) => list.map((id) => `#${id}`).join(' ');
  const items = groups.map(
    (g) => `
      <li class="scope-item">
        <div class="scope-head"><strong>${esc(localized(g.category))}</strong> <span class="tag">${esc(t('idsCount', { n: g.ids.length }))}</span></div>
        <div class="scope-ids">${esc(ids(g.ids))}</div>
        <p class="muted">${esc(localized(g.reason))}</p>
      </li>`,
  );
  if (uncovered.length) {
    items.push(`
      <li class="scope-item scope-uncovered">
        <div class="scope-head"><strong>${esc(t('notCoveredTitle'))}</strong> <span class="tag">${esc(t('idsCount', { n: uncovered.length }))}</span></div>
        <div class="scope-ids">${esc(ids(uncovered))}</div>
        <p class="muted">${esc(t('notCoveredBody'))}</p>
      </li>`);
  }
  return `
    <section class="card">
      <div class="section-head"><h2>${esc(t('outOfScopeTitle'))}</h2></div>
      <p class="muted section-hint">${esc(t('outOfScopeHint'))}</p>
      <ul class="scope-list">${items.join('')}</ul>
    </section>`;
}

function renderVerdict(detection, reference, productionRef) {
  const { counts } = detection;
  const missed = detection.bugs.filter((b) => b.status === 'missed').map((b) => b.ref);
  const problems = [
    missed.length ? t('problemMissed', { refs: missed.join(', ') }) : '',
    detection.unclassified.length ? t('problemUnclassified', { n: detection.unclassified.length }) : '',
    detection.brokenRounds.length ? t('problemBroken', { n: detection.brokenRounds.length }) : '',
  ].filter(Boolean);
  const basis = [
    t('basedOn', { date: fmtDate(reference.startedAt), rounds: reference.rounds }),
    productionRef ? t('productionBasis', { date: fmtDate(productionRef.startedAt) }) : t('noProductionRun'),
  ];
  return `
    <section class="card verdict verdict-${detection.ok ? 'ok' : 'bad'}">
      <span class="verdict-icon" aria-hidden="true">${detection.ok ? ICON.passed : ICON.failed}</span>
      <div>
        <p class="verdict-title">${esc(detection.ok ? t('verdictOk') : t('verdictBad', { problems: problems.join(t('listSep')) }))}</p>
        <p class="muted">${esc(basis[0])} ${runLink(reference)} ${targetTag(BUG_TARGET)}${productionRef ? ` · ${esc(basis[1])} ${runLink(productionRef)}` : ` · ${esc(basis[1])}`}</p>
        <p class="muted small">${esc(t('verdictRule', { caught: counts.caught, inScope: counts.inScope }))}</p>
      </div>
    </section>`;
}

function renderBugKpis(detection, knownBugs) {
  const { counts } = detection;
  const caughtClass = counts.missed ? 'rate-text-bad' : counts.caught === counts.inScope ? 'rate-text-good' : 'rate-text-warn';
  const card = (label, value, sub, valueClass = '') => `
    <div class="card kpi">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value ${valueClass}">${esc(value)}</div>
      <div class="kpi-sub">${esc(sub)}</div>
    </div>`;
  return `
    <section class="kpis bug-kpis">
      ${card(t('kpiCaught'), `${counts.caught} / ${counts.inScope}`, t('kpiCaughtSub', { total: knownBugs.source.total }), caughtClass)}
      ${card(t('kpiBlocked'), counts.blockedCases, t('kpiBlockedSub'))}
      ${card(t('kpiUnlisted'), counts.unlisted, t('kpiUnlistedSub'))}
      ${card(t('kpiOutOfScope'), counts.outOfScope, t('kpiOutOfScopeSub', { groups: counts.outOfScopeGroups }))}
    </section>`;
}

/** The Bug page. `data` comes from loadBugPage(). */
export function renderBugs({ knownBugs, reference, productionRef, withBugs, production }) {
  const back = `<a class="back" href="#/">${esc(t('back'))}</a>`;
  if (!knownBugs) return `${back}<section class="card empty"><p>${esc(t('bugsNoList'))}</p></section>`;
  const detection = withBugs ? classifyRun(withBugs, knownBugs) : null;
  const listUrl = knownBugs.source.listUrl;
  const options = { detection, reference, production, listUrl };

  const top = detection
    ? `${renderVerdict(detection, reference, productionRef)}${renderBugKpis(detection, knownBugs)}`
    : `<section class="card empty">
         <h2>${esc(t('bugsEmptyTitle'))}</h2>
         <p>${esc(t('bugsEmptyBody'))}</p>
         <a class="btn btn-primary" href="#/console">▶ ${esc(t('runTests'))}</a>
       </section>`;
  const unlisted = knownBugs.unlisted?.length
    ? `<section class="card">
         <div class="section-head"><h2>${esc(t('unlistedTitle'))}</h2></div>
         <p class="muted section-hint">${esc(t('unlistedHint'))}</p>
         ${renderFindingTable(knownBugs.unlisted, detection?.unlisted, { ...options, official: false })}
       </section>`
    : '';

  return `
    ${back}
    <section class="hero">
      <h1>${esc(t('bugsTitle'))}</h1>
      <p class="lead">${esc(t('bugsLead', { total: knownBugs.source.total }))}</p>
      <p class="muted bugs-source"><a href="${esc(listUrl)}" target="_blank" rel="noopener">${esc(t('bugsListLink'))} ↗</a> · ${esc(t('bugsListNote'))}</p>
    </section>
    ${top}
    <section class="card">
      <div class="section-head"><h2>${esc(t('bugsTableTitle'))}</h2></div>
      <p class="muted section-hint">${esc(t('bugsTableHint'))}</p>
      ${renderFindingTable(knownBugs.bugs, detection?.bugs, { ...options, official: true })}
    </section>
    ${unlisted}
    ${detection ? renderCaseTable(detection, withBugs, production, reference) : ''}
    ${renderOutOfScope(knownBugs)}`;
}
