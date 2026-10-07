// Results dashboard: run history, one run's "test case x round" matrix, the
// Bug detection page (bugs.js) and the test console (console.js) where the
// owner picks cases and starts runs.
import { messagesOf } from './bug-detection.js';
import {
  bugBadges,
  bugLabel,
  detectionOf,
  fillBugTeaser,
  judgesBugs,
  loadBugPage,
  renderBugDetail,
  renderBugRunNote,
  renderBugs,
  renderBugTeaser,
} from './bugs.js';
import {
  ICON,
  REPO_URL,
  caseDescription,
  caseTitle,
  catalogCase,
  esc,
  fmtDate,
  fmtDuration,
  fmtSeconds,
  loadCatalog,
  loadRuns,
  loadSummary,
  localized,
  moduleName,
  paramText,
  pct,
  rateClass,
  runLabel,
  runPath,
  saveLanguage,
  siteUrl,
  state,
  t,
  targetTag,
  triggerName,
} from './core.js';
import { afterConsoleRender, initTracker, refreshCaseTexts, renderConsole, syncRunIndicator, trackedRun } from './console.js';
import { isEditing, refreshDescriptions } from './editor.js';
import { LANGUAGES } from './i18n.js';
import { DEFAULT_TARGET, isFullRun, targetOf } from './targets.js';

const TREND_SIZE = 30;

function setLanguage(code) {
  saveLanguage(code);
  // Keep the language in the URL so a copied link opens in the same language.
  const url = new URL(location.href);
  url.searchParams.set('lang', code);
  history.replaceState(null, '', url);
  render();
}

/** Test data of one case in one run: { key: value }. */
const runValues = (c) => Object.fromEntries((c.params ?? []).map((p) => [p.key, p.value]));
const customParams = (c) => (c.params ?? []).filter((p) => p.value !== p.default);

// ---------------------------------------------------------------- chrome (header + footer)

function renderHeader() {
  const onBugs = currentRoute().view === 'bugs';
  document.getElementById('header').innerHTML = `
    <div class="container header-inner">
      <a class="brand" href="#/">
        <span class="brand-mark" aria-hidden="true">✓</span>
        <span>${esc(t('appTitle'))}</span>
      </a>
      <div class="header-actions">
        <a class="btn nav-link" href="#/bugs" title="${esc(t('navBugsHint'))}"${onBugs ? ' aria-current="page"' : ''}>
          <span aria-hidden="true">🐞</span> ${esc(t('navBugs'))}</a>
        <a class="btn btn-primary" href="#/console" title="${esc(t('runTestsHint'))}">▶ ${esc(t('runTests'))}
          <span id="run-indicator" class="run-dot" hidden>${esc(t('running'))}</span></a>
        <a class="btn" href="${REPO_URL}" target="_blank" rel="noopener">${esc(t('sourceCode'))}</a>
        <button type="button" class="btn" id="share-btn">${esc(t('share'))}</button>
        <div class="lang-switch" role="group" aria-label="${esc(t('language'))}">
          ${LANGUAGES.map((l) => `<button type="button" data-lang="${l.code}" aria-pressed="${l.code === state.lang}">${esc(l.label)}</button>`).join('')}
        </div>
      </div>
    </div>`;
  syncRunIndicator();
}

function renderFooter() {
  document.getElementById('footer').innerHTML = `
    <div class="container">
      <h2>${esc(t('aboutTitle'))}</h2>
      <ul>${t('about').map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
      <p class="muted">${esc(t('keepNote'))} · <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a></p>
    </div>`;
}

// ---------------------------------------------------------------- home view

function renderRunningBanner() {
  const run = trackedRun();
  if (!run || run.done) return '';
  const target = run.target && run.target !== DEFAULT_TARGET ? ` ${targetTag(run.target)}` : '';
  return `
    <a class="card running-banner" href="#/console">
      <span class="spinner" aria-hidden="true"></span>
      <span>${esc(t('runningBanner', { cases: run.caseCount, rounds: run.rounds }))}${target}</span>
      <span class="running-banner-link">${esc(t('viewProgress'))} →</span>
    </a>`;
}

function renderHome(runs) {
  const intro = `
    <section class="hero">
      <h1>${esc(t('appTitle'))}</h1>
      <p class="lead">${esc(t('appSubtitle'))}</p>
    </section>
    ${renderRunningBanner()}`;

  if (!runs.length) {
    return `${intro}
      <section class="card empty">
        <h2>${esc(t('emptyTitle'))}</h2>
        <p>${esc(t('emptyBody'))}</p>
        <a class="btn btn-primary" href="#/console">▶ ${esc(t('runTests'))}</a>
      </section>
      ${renderBugTeaser()}`;
  }

  // Stats and the trend describe the product: failures on the with-bugs release are expected (#/bugs).
  const production = runs.filter((run) => targetOf(run) === DEFAULT_TARGET);
  const otherRuns = runs.length - production.length;
  const history = `
    <section class="card">
      <div class="section-head"><h2>${esc(t('historyTitle'))}</h2></div>
      <div class="table-wrap">
        <table class="table runs-table">
          <thead>
            <tr>
              <th>${esc(t('colRun'))}</th>
              <th>${esc(t('colStarted'))}</th>
              <th>${esc(t('colTrigger'))}</th>
              <th class="num">${esc(t('colCases'))}</th>
              <th class="num">${esc(t('colRounds'))}</th>
              <th>${esc(t('colPassRate'))}</th>
              <th class="num">${esc(t('colResults'))}</th>
              <th class="num">${esc(t('colDuration'))}</th>
            </tr>
          </thead>
          <tbody>
            ${runs.map(renderRunRow).join('')}
          </tbody>
        </table>
      </div>
    </section>`;

  if (!production.length) {
    return `${intro}
      <section class="card empty"><p>${esc(t('noProductionRuns'))}</p></section>
      ${renderBugTeaser()}
      ${history}`;
  }

  const latest = production[0];
  const executed = latest.totals.passed + latest.totals.failed;
  const catalogSize = state.catalog?.cases.length ?? latest.catalogSize ?? (latest.rounds ? Math.round(latest.totals.total / latest.rounds) : '—');
  const trend = production.slice(0, TREND_SIZE).reverse();

  return `${intro}
    ${otherRuns ? `<p class="muted stats-note">${esc(t('statsProductionOnly'))}</p>` : ''}
    <section class="kpis">
      <a class="card kpi" href="#/run/${encodeURIComponent(latest.id)}">
        <div class="kpi-label">${esc(t('kpiLatest'))}</div>
        <div class="kpi-value rate-text-${rateClass(latest.totals.passRate)}">${pct(latest.totals.passRate)}</div>
        <div class="kpi-sub">${latest.totals.passed} / ${executed} · ${esc(runLabel(latest))}</div>
      </a>
      <div class="card kpi">
        <div class="kpi-label">${esc(t('kpiLastRun'))}</div>
        <div class="kpi-value kpi-value-sm">${esc(fmtDate(latest.startedAt))}</div>
        <div class="kpi-sub">${esc(triggerName(latest.trigger))} · ${esc(t('rounds'))} ${latest.rounds}</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">${esc(t('kpiRuns'))}</div>
        <div class="kpi-value">${production.length}</div>
        <div class="kpi-sub">${esc(otherRuns ? t('kpiRunsOther', { n: otherRuns }) : t('keepNote'))}</div>
      </div>
      <a class="card kpi" href="#/console">
        <div class="kpi-label">${esc(t('kpiCases'))}</div>
        <div class="kpi-value">${catalogSize}</div>
        <div class="kpi-sub">Chromium · Playwright · ${esc(t('kpiCasesLink'))} →</div>
      </a>
    </section>

    ${renderBugTeaser()}

    <section class="card">
      <div class="section-head">
        <h2>${esc(t('trendTitle'))}</h2>
        <span class="muted">${esc(t('trendHint', { n: trend.length }))}</span>
      </div>
      <div class="trend" role="list">
        ${trend
          .map((run) => {
            const rate = run.totals.passRate ?? 0;
            const label = `${runLabel(run)} · ${pct(run.totals.passRate)} · ${fmtDate(run.startedAt)}`;
            return `<a role="listitem" class="bar bg-${rateClass(run.totals.passRate)}" style="--h:${Math.max(rate * 100, 2)}%"
                       href="#/run/${encodeURIComponent(run.id)}" title="${esc(label)}" aria-label="${esc(label)}"></a>`;
          })
          .join('')}
      </div>
    </section>
    ${history}`;
}

function renderRunRow(run) {
  const href = `#/run/${encodeURIComponent(run.id)}`;
  const broken = run.brokenRounds ? ` <span class="tag tag-bad" title="${esc(t('roundBroken'))}">⚠ ${run.brokenRounds}</span>` : '';
  // Runs recorded before case selection existed always ran every case.
  const caseCount = run.caseCount ?? (run.rounds ? Math.round(run.totals.total / run.rounds) : '—');
  const cases = run.catalogSize && !isFullRun(run) ? `${caseCount}/${run.catalogSize}` : `${caseCount}`;
  const custom = run.customData ? ` <span class="tag tag-custom" title="${esc(t('customDataHint'))}">${esc(t('custom'))}</span>` : '';
  // Failures on the with-bugs release are expected, so its pass rate is not coloured as good or bad.
  const bugRun = judgesBugs(run);
  const rate = bugRun ? 'na' : rateClass(run.totals.passRate);
  return `
    <tr class="clickable" data-href="${href}">
      <td><a href="${href}">${esc(runLabel(run))}</a>${broken}${bugRun ? ` ${targetTag(targetOf(run))}` : ''}</td>
      <td>${esc(fmtDate(run.startedAt))}</td>
      <td><span class="tag tag-${esc(run.trigger)}">${esc(triggerName(run.trigger))}</span></td>
      <td class="num">${esc(cases)}${custom}</td>
      <td class="num">${run.rounds}</td>
      <td>
        <div class="rate">
          <div class="rate-bar"><span class="bg-${rate}" style="width:${(run.totals.passRate ?? 0) * 100}%"></span></div>
          <span class="rate-text-${rate}">${pct(run.totals.passRate)}</span>
        </div>
      </td>
      <td class="num"><span class="ok">${run.totals.passed}</span> / <span class="${run.totals.failed ? (bugRun ? 'muted' : 'ko') : 'muted'}">${run.totals.failed}</span></td>
      <td class="num">${esc(fmtDuration(run.durationMs))}</td>
    </tr>`;
}

// ---------------------------------------------------------------- run view

/** Groups cases by module; modules are ordered by their first case id. */
function groupByModule(cases) {
  const groups = new Map();
  for (const c of [...cases].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!groups.has(c.module)) groups.set(c.module, []);
    groups.get(c.module).push(c);
  }
  return [...groups.entries()];
}

function renderRun(summary) {
  const rounds = summary.roundSummaries;
  const executed = summary.totals.passed + summary.totals.failed;
  const commitUrl = summary.repoUrl && summary.commit ? `${summary.repoUrl}/commit/${summary.commit}` : null;
  const catalogSize = summary.selection?.catalogSize ?? summary.cases.length;
  // "All" = every case that applies to the run's target (older summaries: every case in the catalog).
  const allCases = summary.selection?.all ?? summary.cases.length === catalogSize;
  const applicable = summary.selection?.applicable ?? catalogSize;
  const customCases = summary.cases.filter((c) => customParams(c).length).length;
  const target = targetOf(summary);
  const site = siteUrl(summary, target);
  // with-bugs: every failure is matched to a known bug (null for production runs).
  const detection = detectionOf(summary);
  const bugRun = judgesBugs(summary);

  const meta = [
    [t('started'), esc(fmtDate(summary.startedAt))],
    [t('duration'), esc(fmtDuration(summary.durationMs))],
    [t('rounds'), summary.rounds],
    [t('casesRun'), esc(allCases ? t('casesAll', { n: applicable }) : `${summary.cases.length} / ${applicable}`)],
    [t('testData'), esc(customCases ? t('testDataCustom', { n: customCases }) : t('testDataDefault'))],
    [t('trigger'), esc(triggerName(summary.trigger))],
    [t('browser'), `Chromium · Playwright ${esc(summary.playwrightVersion)}`],
    [t('target'), `<a href="${esc(site)}" target="_blank" rel="noopener">${esc(new URL(site).host)}</a>`],
    commitUrl ? [t('commit'), `<a href="${esc(commitUrl)}" target="_blank" rel="noopener"><code>${esc(summary.commit)}</code></a>`] : null,
    summary.workflowRunUrl ? ['GitHub Actions', `<a href="${esc(summary.workflowRunUrl)}" target="_blank" rel="noopener">${esc(t('workflowLog'))} ↗</a>`] : null,
  ].filter(Boolean);

  const roundCards = rounds
    .map((r) => {
      const total = r.passed + r.failed + r.skipped;
      const broken = total === 0;
      return `
        <div class="card round-card ${broken || r.failed ? 'round-bad' : 'round-good'}">
          <div class="round-title">${esc(t('roundN', { n: r.round }))}</div>
          ${
            broken
              ? `<div class="ko">${esc(t('roundBroken'))}</div>${r.error ? `<details><summary>${esc(t('error'))}</summary><pre class="error">${esc(r.error)}</pre></details>` : ''}`
              : `<div class="round-stats"><span class="ok">${ICON.passed} ${r.passed}</span><span class="${r.failed ? 'ko' : 'muted'}">${ICON.failed} ${r.failed}</span>${r.skipped ? `<span class="muted">${ICON.skipped} ${r.skipped}</span>` : ''}</div>`
          }
          <div class="muted">${esc(fmtDuration(r.durationMs))}</div>
          ${broken ? '' : `<a href="${runPath(summary.id, r.report)}" target="_blank" rel="noopener">${esc(t('report'))} ↗</a>`}
        </div>`;
    })
    .join('');

  const header = `
    <tr>
      <th class="case-col" scope="col">${esc(t('colCase'))}</th>
      ${rounds
        .map((r) => {
          const total = r.passed + r.failed + r.skipped;
          return `<th scope="col" class="round-col"><a href="${runPath(summary.id, r.report)}" target="_blank" rel="noopener" title="${esc(t('report'))}">${esc(t('roundShort', { n: r.round }))}</a><small>${total ? `${r.passed}/${total}` : '—'}</small></th>`;
        })
        .join('')}
      <th scope="col" class="num">${esc(t('colPassRate'))}</th>
    </tr>`;

  const body = groupByModule(summary.cases)
    .map(
      ([module, cases]) => `
        <tr class="module-row"><th colspan="${rounds.length + 2}" scope="colgroup">${esc(moduleName(module))}</th></tr>
        ${cases.map((c) => renderCaseRow(c, rounds, detection?.cases[c.id])).join('')}`,
    )
    .join('');
  // Failures are expected on the with-bugs release, so its pass rate is not coloured as good or bad.
  const scoreClass = bugRun ? 'na' : rateClass(summary.totals.passRate);

  return `
    <a class="back" href="#/">${esc(t('back'))}</a>
    <section class="card run-head">
      <div>
        <h1>${esc(runLabel(summary))} <span class="tag tag-${esc(summary.trigger)}">${esc(triggerName(summary.trigger))}</span> ${targetTag(target)}</h1>
        <dl class="meta">${meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>
      </div>
      <div class="score">
        <div class="score-value rate-text-${scoreClass}">${pct(summary.totals.passRate)}</div>
        <div class="score-sub">
          <span class="ok">${esc(t('passed'))} ${summary.totals.passed}</span> ·
          <span class="${summary.totals.failed && !bugRun ? 'ko' : 'muted'}">${esc(t('failed'))} ${summary.totals.failed}</span>
          ${summary.totals.skipped ? ` · <span class="muted">${esc(t('skipped'))} ${summary.totals.skipped}</span>` : ''}
        </div>
        <div class="muted">${summary.totals.passed} / ${executed}</div>
      </div>
    </section>
    ${bugRun ? renderBugRunNote(detection) : ''}

    <section>
      <h2 class="section-title">${esc(t('roundsTitle'))}</h2>
      <div class="rounds">${roundCards}</div>
    </section>

    <section class="card">
      <div class="section-head">
        <h2>${esc(t('matrixTitle'))}</h2>
        <div class="legend">
          <span><span class="cell cell-passed">${ICON.passed}</span> ${esc(t('passed'))}</span>
          <span><span class="cell cell-failed">${ICON.failed}</span> ${esc(t('failed'))}</span>
          <span><span class="cell cell-skipped">${ICON.skipped}</span> ${esc(t('skipped'))}</span>
        </div>
      </div>
      <p class="muted">${esc(t('matrixHint'))}</p>
      <div class="table-wrap">
        <table class="matrix">
          <thead>${header}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>
    ${renderRtpSimulation(summary.rtpSimulation)}`;
}

function renderRtpSimulation(sim) {
  if (!sim || !sim.rtp || !sim.probabilities) return '';
  const zones = [
    { key: 'banker', hits: sim.outcomes?.BANKER ?? 0 },
    { key: 'player', hits: sim.outcomes?.PLAYER ?? 0 },
    { key: 'tie', hits: sim.outcomes?.TIE ?? 0 },
    { key: 'playerPair', hits: sim.outcomes?.playerPair ?? 0 },
    { key: 'bankerPair', hits: sim.outcomes?.bankerPair ?? 0 },
  ];
  const fmtPct = (v) => `${(Number(v ?? 0) * 100).toFixed(2)}%`;
  const rows = zones
    .map(({ key, hits }) => {
      const empProb = sim.probabilities[key];
      const theoProb = sim.theoreticalProb?.[key];
      const empRtp = sim.rtp[key];
      const theoRtp = sim.theoreticalRtp?.[key];
      const delta = empRtp - theoRtp;
      const ok = Math.abs(delta) <= 0.005;
      const sign = delta >= 0 ? '+' : '';
      return `
        <tr>
          <td><strong>${esc(t(`rtpZone_${key}`))}</strong></td>
          <td class="num">${esc(hits.toLocaleString())}</td>
          <td class="num">${esc(fmtPct(empProb))}</td>
          <td class="num muted">${esc(fmtPct(theoProb))}</td>
          <td class="num"><strong class="${ok ? 'ok' : 'ko'}">${esc(fmtPct(empRtp))}</strong></td>
          <td class="num muted">${esc(fmtPct(theoRtp))}</td>
          <td class="num ${ok ? 'muted' : 'ko'}">${esc(`${sign}${(delta * 100).toFixed(2)}%`)}</td>
          <td><span class="pill pill-${ok ? 'passed' : 'missed'}">${esc(t(ok ? 'rtpStatusOk' : 'rtpStatusSkewed'))}</span></td>
        </tr>`;
    })
    .join('');
  return `
    <section class="card" id="rtp-simulation">
      <div class="section-head">
        <h2>${esc(t('rtpTitle'))}</h2>
        <span class="muted">${esc(t('rtpSub', { seed: sim.seed ?? 20261007, rounds: (sim.rounds ?? 100000).toLocaleString() }))}</span>
      </div>
      <p class="muted">${esc(t('rtpHint'))}</p>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>${esc(t('colRtpZone'))}</th>
              <th class="num">${esc(t('colRtpHits'))}</th>
              <th class="num">${esc(t('colRtpEmpProb'))}</th>
              <th class="num">${esc(t('colRtpTheoProb'))}</th>
              <th class="num">${esc(t('colRtpEmpRtp'))}</th>
              <th class="num">${esc(t('colRtpTheoRtp'))}</th>
              <th class="num">${esc(t('colRtpDelta'))}</th>
              <th>${esc(t('colRtpStatus'))}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

/** One case's row in the matrix. `detected`: its with-bugs classification (bug-detection.js), if any. */
function renderCaseRow(c, rounds, detected = null) {
  const statuses = c.results.map((r) => r.status);
  const flaky = statuses.includes('passed') && statuses.includes('failed');
  const blocked = c.results.some((r) => r.blocked);
  const custom = customParams(c);
  const badges = bugBadges(detected);
  const cells = rounds
    .map((round) => {
      const result = c.results.find((r) => r.round === round.round);
      if (!result) return `<td><span class="cell cell-none" title="${esc(t('notRun'))}">${ICON.none}</span></td>`;
      const bug = bugLabel(detected?.rounds.find((r) => r.round === round.round));
      const label = `${c.id} · ${t('roundN', { n: round.round })} · ${t(result.status)}${result.blocked ? ` (${t('blocked')})` : ''}${bug ? ` · ${bug}` : ''}`;
      return `<td><button type="button" class="cell cell-${result.status}" data-case="${esc(c.id)}" data-round="${round.round}" title="${esc(label)}" aria-label="${esc(label)}">${ICON[result.status]}</button></td>`;
    })
    .join('');
  const customTitle = custom.map((p) => `${paramLabel(c.id, p.key)}: ${paramValueText(c.id, p.key, p.value)}`).join(' · ');
  return `
    <tr>
      <th class="case-col" scope="row">
        <span class="case-id">${esc(c.id)}</span>
        <span class="case-title" title="${esc(caseDescription(c.id, runValues(c)))}">${esc(caseTitle(c.id, c.title))}</span>
        ${custom.length ? `<span class="tag tag-custom" title="${esc(customTitle)}">${esc(t('custom'))}</span>` : ''}
        ${badges ? `<div class="bug-badges">${badges}</div>` : ''}
      </th>
      ${cells}
      <td class="num">
        <span class="rate-text-${detected ? 'na' : rateClass(c.passRate)}">${pct(c.passRate)}</span>
        ${flaky ? `<span class="tag tag-warn" title="${esc(t('flakyHint'))}">${esc(t('flaky'))}</span>` : ''}
        ${blocked ? `<span class="tag tag-blocked" title="${esc(t('blockedNote'))}">${esc(t('blocked'))}</span>` : ''}
      </td>
    </tr>`;
}

// ---------------------------------------------------------------- detail dialog

const paramLabel = (caseId, key) => localized(catalogCase(caseId)?.params?.[key]?.label) || key;
const paramValueText = (caseId, key, value) => paramText(catalogCase(caseId)?.params?.[key], value);

function resultNote(result) {
  if (result.status === 'passed') return t('passedNote');
  if (result.status !== 'skipped') return null;
  if (result.blocked) return t('blockedNote');
  return result.skipReason ? `${t('skippedNote')} ${t('skipReason', { reason: result.skipReason })}` : t('skippedNote');
}

function renderTestData(c) {
  if (!c.params?.length) return '';
  const rows = c.params
    .map((p) => {
      const custom = p.value !== p.default;
      const note = custom ? ` <span class="tag tag-custom">${esc(t('custom'))}</span> <span class="muted">${esc(t('defaultIs', { value: paramValueText(c.id, p.key, p.default) }))}</span>` : '';
      return `<div><dt>${esc(paramLabel(c.id, p.key))}</dt><dd>${esc(paramValueText(c.id, p.key, p.value))}${note}</dd></div>`;
    })
    .join('');
  return `<section><h4>${esc(t('testDataUsed'))}</h4><dl class="data-list">${rows}</dl></section>`;
}

function renderDetail() {
  const dialog = document.getElementById('detail');
  const { runId, caseId, round } = state.openCell;
  const summary = state.summaries.get(runId);
  const c = summary?.cases.find((x) => x.id === caseId);
  const result = c?.results.find((r) => r.round === round);
  if (!result) return;

  const note = resultNote(result);
  const description = caseDescription(c.id, runValues(c), { html: true });
  // Soft assertions report one message each; older summaries kept only the first.
  const messages = result.status === 'failed' ? messagesOf(result) : [];
  const detected = detectionOf(summary)?.cases[c.id]?.rounds.find((r) => r.round === round);
  dialog.innerHTML = `
    <div class="dialog-inner">
      <header class="dialog-head">
        <div>
          <div class="muted">${esc(c.id)} · ${esc(moduleName(c.module))}</div>
          <h3>${esc(caseTitle(c.id, c.title))}</h3>
          <div>
            ${esc(t('roundN', { n: round }))} ·
            <span class="status status-${result.status}">${ICON[result.status]} ${esc(t(result.status))}</span>
            ${result.blocked ? `<span class="tag tag-blocked">${esc(t('blocked'))}</span>` : ''} ·
            ${esc(fmtSeconds(result.durationMs))}
          </div>
        </div>
        <button type="button" class="btn-close" data-close aria-label="${esc(t('close'))}">✕</button>
      </header>
      ${description ? `<section><h4>${esc(t('verifies'))}</h4><p>${description}</p></section>` : ''}
      ${renderTestData(c)}
      ${note ? `<p class="muted">${esc(note)}</p>` : ''}
      ${renderBugDetail(detected)}
      ${messages.length ? `<section><h4>${esc(t('error'))}</h4>${messages.map((m) => `<pre class="error">${esc(m)}</pre>`).join('')}</section>` : ''}
      ${
        result.screenshot
          ? `<section><h4>${esc(t('screenshot'))}</h4>
               <a href="${runPath(runId, result.screenshot)}" target="_blank" rel="noopener">
                 <img class="shot" src="${runPath(runId, result.screenshot)}" alt="${esc(t('screenshot'))}" loading="lazy">
               </a></section>`
          : ''
      }
      <div class="dialog-actions">
        <a class="btn btn-primary" href="${runPath(runId, result.reportLink)}" target="_blank" rel="noopener">${esc(t('openInReport'))} ↗</a>
        ${catalogCase(c.id) ? `<a class="btn" href="#/console/${encodeURIComponent(c.id)}">${esc(t('openInConsole'))}</a>` : ''}
        <button type="button" class="btn" data-close>${esc(t('close'))}</button>
      </div>
    </div>`;
  if (!dialog.open) dialog.showModal();
}

function closeDetail() {
  state.openCell = null;
  const dialog = document.getElementById('detail');
  if (dialog.open) dialog.close();
}

// ---------------------------------------------------------------- routing + rendering

function currentRoute() {
  const run = /^#\/run\/([^/?]+)$/.exec(location.hash);
  if (run) return { view: 'run', id: decodeURIComponent(run[1]) };
  const consoleRoute = /^#\/console(?:\/(TC\d{2}))?$/.exec(location.hash);
  if (consoleRoute) return { view: 'console', focus: consoleRoute[1] ?? null };
  if (/^#\/bugs\/?$/.test(location.hash)) return { view: 'bugs' };
  return { view: 'home' };
}

function renderNotPublished(run) {
  return `
    <a class="back" href="#/">${esc(t('back'))}</a>
    <section class="card empty">
      <h2>${esc(run.runNumber ? t('runTitle', { n: run.runNumber }) : t('runThis'))}</h2>
      <p>${esc(t('notPublishedYet'))}</p>
      <a class="btn btn-primary" href="#/console">${esc(t('viewProgress'))} →</a>
    </section>`;
}

async function render() {
  const token = ++state.renderToken;
  document.documentElement.lang = state.lang;
  renderHeader();
  renderFooter();

  const app = document.getElementById('app');
  const route = currentRoute();
  const cached = route.view === 'run' ? state.summaries.has(route.id) : route.view === 'console' ? state.catalog !== null : state.runs !== null;
  if (!cached) app.innerHTML = `<p class="muted loading">${esc(t('loading'))}</p>`;

  try {
    if (route.view === 'console') {
      await loadCatalog();
      if (token !== state.renderToken) return;
      app.innerHTML = renderConsole(route.focus);
      document.title = `${t('consoleTitle')} · ${t('appTitle')}`;
      afterConsoleRender(route.focus);
    } else if (route.view === 'bugs') {
      const data = await loadBugPage();
      if (token !== state.renderToken) return;
      app.innerHTML = renderBugs(data);
      document.title = `${t('bugsTitle')} · ${t('appTitle')}`;
    } else {
      // Titles and descriptions come from the catalog; older deploys without one fall back to the code titles.
      const catalog = loadCatalog().catch(() => null);
      if (route.view === 'run') {
        const [summary] = await Promise.all([loadSummary(route.id), catalog]);
        if (token !== state.renderToken) return;
        app.innerHTML = renderRun(summary);
        document.title = `${runLabel(summary)} · ${t('appTitle')}`;
      } else {
        const [runs] = await Promise.all([loadRuns(), catalog]);
        if (token !== state.renderToken) return;
        app.innerHTML = renderHome(runs);
        document.title = t('appTitle');
        void fillBugTeaser(runs, () => token === state.renderToken);
      }
    }
  } catch (error) {
    if (token !== state.renderToken) return;
    const tracked = trackedRun();
    if (route.view === 'run' && error.status === 404 && tracked?.id === route.id && tracked.outcome !== 'published') {
      app.innerHTML = renderNotPublished(tracked);
    } else {
      const message = route.view === 'run' && error.status === 404 ? t('notFound') : t('loadError', { msg: error.message });
      app.innerHTML = `<a class="back" href="#/">${esc(t('back'))}</a><section class="card empty"><p class="ko">${esc(message)}</p></section>`;
    }
    document.title = t('appTitle');
  }

  if (state.openCell) renderDetail();
}

// ---------------------------------------------------------------- events

document.addEventListener('click', async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const langButton = target.closest('[data-lang]');
  if (langButton) return setLanguage(langButton.dataset.lang);

  if (target.closest('#share-btn')) {
    const button = target.closest('#share-btn');
    try {
      await navigator.clipboard.writeText(location.href);
      button.textContent = t('copied');
    } catch {
      window.prompt(t('share'), location.href);
    }
    setTimeout(() => (button.textContent = t('share')), 2000);
    return;
  }

  const cell = target.closest('button.cell[data-case]');
  if (cell) {
    const route = currentRoute();
    state.openCell = { runId: route.id, caseId: cell.dataset.case, round: Number(cell.dataset.round) };
    return renderDetail();
  }

  if (target.closest('[data-close]') || target.id === 'detail') return closeDetail(); // button or backdrop

  const row = target.closest('tr[data-href]');
  if (row && !target.closest('a')) location.hash = row.dataset.href;
});

document.getElementById('detail').addEventListener('close', () => (state.openCell = null));

window.addEventListener('hashchange', () => {
  closeDetail();
  render();
  window.scrollTo(0, 0);
});

initTracker({
  // A run started from the console was published: the history (and maybe the Bug page's reference run) now includes it.
  onPublished: () => {
    state.runs = null;
    if (['home', 'bugs'].includes(currentRoute().view)) render();
  },
});

render();

// catalog.json holds the descriptions of the last deploy; edits made since then come from GitHub.
refreshDescriptions().then((changed) => {
  if (!changed || isEditing()) return;
  if (currentRoute().view === 'console') refreshCaseTexts();
  else render();
});
