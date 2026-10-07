import { expect, test } from './fixtures/test';
import { FIXED_NOW } from './fixtures/clock';
import { publishedRun } from './fixtures/results';
import { applicableCases, siteCatalog } from './fixtures/site';

test.describe('Bug detection page and with-bugs runs', () => {
  test('lists known bugs and out-of-scope categories even before a with-bugs run is published', async ({ bugsPage }) => {
    const knownBugs = siteCatalog().knownBugs;
    await bugsPage.goto();

    await expect(bugsPage.heading).toHaveText('博奕缺陷偵測報告（with-bugs 故障注入版）');
    await expect(bugsPage.emptyState.getByRole('heading')).toHaveText('還沒有 with-bugs 模式的完整執行紀錄');
    await expect(bugsPage.bugTables.first().locator('tbody tr')).toHaveCount(knownBugs?.bugs.length ?? 0);
    await expect(bugsPage.bugRow('#1')).toContainText('TC04');
    await expect(bugsPage.bugRow('#5')).toContainText('TC14');
    await expect(bugsPage.scopeItems).toHaveCount(2);
  });

  test('classifies caught bugs on the Bug page and the with-bugs run page', async ({
    bugsPage,
    runPage,
    siteData,
  }) => {
    const cases = applicableCases('with-bugs').map((c) => ({
      id: c.id,
      statuses: [c.id === 'TC04' || c.id === 'TC14' ? ('failed' as const) : ('passed' as const)],
      errors:
        c.id === 'TC04'
          ? ['Error: [TC04 banker-3-vs-8] Expected Banker to stand on initial 3 when Player third card is 8']
          : c.id === 'TC14'
            ? ['Error: [TC14 race-condition] Wallet balance dropped below $0.00 to -$800.00']
            : undefined,
    }));
    const run = publishedRun({
      id: '21000000007',
      runNumber: 7,
      startedAt: FIXED_NOW,
      target: 'with-bugs',
      cases,
    });
    await siteData.publish(run);

    await bugsPage.goto();
    await expect(bugsPage.verdict).toBeVisible();
    await expect(bugsPage.bugRow('#1').locator('.pill-caught')).toHaveText('✓ 已抓到');
    await expect(bugsPage.bugRow('#5').locator('.pill-caught')).toHaveText('✓ 已抓到');
    await expect(bugsPage.caseRow('TC04').locator('.pill-caught')).toHaveText('抓到 #1');
    await expect(bugsPage.caseRow('TC14').locator('.pill-caught')).toHaveText('抓到 #5');

    await runPage.goto(run.entry.id);
    await expect(runPage.heading).toHaveText('執行 #7 手動 with-bugs');
    await expect(runPage.main.locator('.bug-note')).toContainText('抓到 2 個已知缺陷 · 0 條案例被前置問題阻擋 · 0 條未歸類');
    await expect(runPage.caseRow('TC04').locator('.bug-badge-caught')).toHaveText('抓到 #1');
    await expect(runPage.caseRow('TC14').locator('.bug-badge-caught')).toHaveText('抓到 #5');

    await runPage.openCell('TC04', 1);
    await expect(runPage.detail.root.locator('.bug-detail')).toContainText('#1');
  });
});
