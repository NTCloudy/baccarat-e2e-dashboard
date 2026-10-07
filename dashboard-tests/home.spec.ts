import { expect, test } from './fixtures/test';
import { RUNS, fixtureRuns } from './fixtures/results';
import { siteCatalog } from './fixtures/site';

test.describe('Home page', () => {
  test('lists every run newest first with its cases, trigger, rounds, pass rate, results and duration', async ({ home }) => {
    await home.goto();

    await expect(home.heading).toHaveText('百家樂桌台與單一錢包 QA 自動化儀表板');
    await expect(home.runRows).toHaveCount(fixtureRuns().length);
    await expect(home.runRows.locator('td:first-child a')).toHaveText(['本機執行', '執行 #3', '執行 #2', '執行 #1']);
    await expect(home.runRow('本機執行').locator('td')).toHaveText(['本機執行', '2026/10/6 21:30', '本機', '4/16 自訂', '1', '100%', '4 / 0', '1 分 1 秒']);
    await expect(home.runRow('執行 #3').locator('td')).toHaveText(['執行 #3', '2026/10/5 16:00', '手動', '4/16', '3', '88.9%', '8 / 1', '4 分 5 秒']);
    // A run recorded before case selection existed has no case count: it ran all of its cases.
    await expect(home.runRow('執行 #1').locator('td')).toHaveText(['執行 #1', '2026/9/28 09:00', '每週排程', '4', '1', '100%', '4 / 0', '30 秒']);
  });

  test('tags runs with custom test data and runs with a broken round', async ({ home }) => {
    await home.goto();

    const customTag = home.runRow('本機執行').locator('.tag-custom');
    await expect(customTag).toHaveText('自訂');
    await expect(customTag).toHaveAttribute('title', '這次執行有案例用了自訂的測試資料');
    await expect(home.runRow('執行 #3').locator('.tag-custom')).toHaveCount(0);

    const brokenTag = home.runRow('執行 #2').locator('.tag-bad');
    await expect(brokenTag).toHaveText('⚠ 1');
    await expect(brokenTag).toHaveAttribute('title', '這一輪沒有產生測試結果');
    await expect(home.runRow('執行 #2').locator('.rate-text-bad')).toHaveText('33.3%');
  });

  test('summarizes the latest run in the KPI cards', async ({ home }) => {
    await home.goto();

    await expect(home.kpi('最近一次通過率')).toContainText('100%');
    await expect(home.kpi('最近一次通過率')).toContainText('4 / 4 · 本機執行');
    await expect(home.kpi('最近一次通過率')).toHaveAttribute('href', `#/run/${RUNS.local}`);
    await expect(home.kpi('最近一次執行')).toContainText('2026/10/6 21:30');
    await expect(home.kpi('最近一次執行')).toContainText('本機 · 輪數 1');
    await expect(home.kpi('執行次數').locator('.kpi-value')).toHaveText(String(fixtureRuns().length));
    await expect(home.kpi('測試案例').locator('.kpi-value')).toHaveText(String(siteCatalog().cases.length));
    await expect(home.kpi('測試案例')).toHaveAttribute('href', '#/console');
  });

  test('draws one pass-rate bar per run, oldest first, colored by pass rate, each opening its run', async ({ home, runPage }) => {
    await home.goto();

    await expect(home.trendHint).toHaveText('最近 4 次執行；點長條可查看該次結果');
    await expect(home.trendBars).toHaveCount(4);
    await expect(home.trendBars.nth(0)).toHaveAttribute('aria-label', '執行 #1 · 100% · 2026/9/28 09:00');
    await expect(home.trendBars.nth(3)).toHaveAttribute('aria-label', '本機執行 · 100% · 2026/10/6 21:30');
    await expect(home.trendBars).toHaveClass([/bg-good/, /bg-bad/, /bg-warn/, /bg-good/]);

    await home.trendBars.nth(2).click();
    await expect(home.page).toHaveURL(new RegExp(`#/run/${RUNS.mixed}$`));
    await expect(runPage.heading).toHaveText('執行 #3 手動 production');
  });

  test('opens a run when its row is clicked anywhere', async ({ home, runPage }) => {
    await home.goto();

    await home.runRow('執行 #2').locator('td').nth(4).click();

    await expect(home.page).toHaveURL(new RegExp(`#/run/${RUNS.broken}$`));
    await expect(runPage.heading).toHaveText('執行 #2 手動 production');
  });

  test('invites to run tests while no run has been published', async ({ home, siteData }) => {
    await siteData.setRuns([]);
    await home.goto();

    await expect(home.emptyState.getByRole('heading')).toHaveText('還沒有執行紀錄');
    await expect(home.emptyState.getByRole('link')).toHaveAttribute('href', '#/console');
    await expect(home.runRows).toHaveCount(0);
  });
});
