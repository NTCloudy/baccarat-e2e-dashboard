import { expect, test } from './fixtures/test';
import { RUNS } from './fixtures/results';
import { deployedText, filledDescription } from './fixtures/site';

test.describe('Run page', () => {
  test("shows the run's meta data, score, round cards, matrix grouped by module, and 100k Monte Carlo RTP table", async ({ runPage }) => {
    await runPage.goto(RUNS.mixed);

    await expect(runPage.heading).toHaveText('執行 #3 手動 production');
    await expect(runPage.meta('開始時間')).toHaveText('2026/10/5 16:00');
    await expect(runPage.meta('耗時')).toHaveText('4 分 5 秒');
    await expect(runPage.meta('輪數')).toHaveText('3');
    await expect(runPage.meta('測試案例')).toHaveText('4 / 16');
    await expect(runPage.meta('測試資料')).toHaveText('預設值');
    await expect(runPage.meta('瀏覽器')).toHaveText('Chromium · Playwright 1.62.1');
    await expect(runPage.meta('測試引擎模式').getByRole('link')).toHaveText('127.0.0.1:4100');
    await expect(runPage.meta('Commit').getByRole('link')).toHaveAttribute('href', 'https://github.com/NTCloudy/baccarat-e2e-dashboard/commit/abc1234');
    await expect(runPage.meta('GitHub Actions').getByRole('link')).toHaveAttribute(
      'href',
      'https://github.com/NTCloudy/baccarat-e2e-dashboard/actions/runs/21000000003',
    );

    await expect(runPage.score).toHaveText('88.9%');
    await expect(runPage.scoreDetails).toHaveText('通過 8 · 失敗 1 · 略過 3');

    await expect(runPage.roundCards).toHaveCount(3);
    await expect(runPage.roundCards).toHaveClass([/round-good/, /round-bad/, /round-good/]);
    await expect(runPage.roundCards.nth(1).locator('.round-stats')).toHaveText('✓ 2✕ 1– 1');
    await expect(runPage.roundCards.nth(1).getByRole('link')).toHaveAttribute('href', `data/runs/${RUNS.mixed}/rounds/round-2/report/index.html`);

    await expect(runPage.matrixHeader).toHaveText(['測試案例', '第1輪3/4', '第2輪2/4', '第3輪3/4', '通過率']);
    await expect(runPage.moduleRows).toHaveText([
      '補牌規則（Tableau）',
      '派彩與抽水（Payout）',
      '單一錢包與併發（Wallet）',
      '桌台路單與 10 萬局 RTP（Table & RTP）',
    ]);
    await expect(runPage.caseRows.locator('.case-id')).toHaveText(['TC06', 'TC10', 'TC14', 'TC17']);
    await expect(runPage.caseRow('TC10').locator('.case-title')).toHaveText(deployedText('TC10', 'title', 'zh-TW'));
    await expect(runPage.caseRow('TC10').locator('button.cell')).toHaveText(['✓', '✕', '✓']);
    await expect(runPage.caseRow('TC10').locator('td.num')).toHaveText('66.7% 不穩定');
    await expect(runPage.caseRow('TC06').locator('button.cell')).toHaveClass([/cell-skipped/, /cell-skipped/, /cell-skipped/]);
    await expect(runPage.caseRow('TC06').locator('td.num')).toHaveText('— 被擋下');

    // Verify the 100,000-round Monte Carlo RTP & Probability panel renders on the Run page.
    const rtpPanel = runPage.main.locator('#rtp-simulation');
    await expect(rtpPanel).toBeVisible();
    await expect(rtpPanel.getByRole('heading', { level: 2 })).toHaveText('100,000 局蒙地卡羅 RTP 與機率分佈驗證');
    await expect(rtpPanel.locator('tbody tr')).toHaveCount(5);
    await expect(rtpPanel).toContainText('莊家 Banker（1 : 0.95）');
    await expect(rtpPanel).toContainText('98.94%');
  });

  test('marks the cases that ran with custom test data', async ({ runPage }) => {
    await runPage.goto(RUNS.local);

    await expect(runPage.heading).toHaveText('本機執行 本機 production');
    await expect(runPage.meta('測試資料')).toHaveText('2 條案例用了自訂值');
    await expect(runPage.caseRows.filter({ has: runPage.page.locator('.tag-custom') }).locator('.case-id')).toHaveText(['TC07', 'TC08']);
    await expect(runPage.caseRow('TC07').locator('.tag-custom')).toHaveAttribute('title', '閒家下注金額: 200');
    await expect(runPage.caseRow('TC08').locator('.tag-custom')).toHaveAttribute('title', '莊家下注金額（含小數抽水）: 100');
    // Hovering a title shows the description with the data of this run.
    await expect(runPage.caseRow('TC07').locator('.case-title')).toHaveAttribute('title', filledDescription('TC07', 'zh-TW', { amount: 200 }));
  });

  test('explains a round that produced no results and marks the cases it did not run', async ({ runPage }) => {
    await runPage.goto(RUNS.broken);

    const broken = runPage.roundCards.nth(1);
    await expect(broken).toHaveClass(/round-bad/);
    await expect(broken.locator('.ko')).toHaveText('這一輪沒有產生測試結果');
    await broken.getByText('錯誤訊息').click();
    await expect(broken.locator('pre.error')).toHaveText('No results.json was produced for this round.');
    await expect(broken.getByRole('link')).toHaveCount(0);

    await expect(runPage.matrixHeader.nth(2)).toHaveText('第2輪—');
    await expect(runPage.cell('TC05', 2)).toHaveText('·');
    await expect(runPage.cell('TC05', 2)).toHaveAttribute('title', '未執行');
  });

  test('shows a run recorded before case selection existed as a run of all its cases', async ({ runPage }) => {
    await runPage.goto(RUNS.legacy);

    await expect(runPage.heading).toHaveText('執行 #1 每週排程 production');
    await expect(runPage.meta('測試案例')).toHaveText('全部 4 條');
    await expect(runPage.meta('測試資料')).toHaveText('預設值');
    await expect(runPage.caseRows).toHaveCount(4);
  });

  test('reports a run id that is not in the history', async ({ runPage }) => {
    await runPage.goto('99999');

    await expect(runPage.notice).toHaveText('找不到這次執行（可能已超過保留的 30 次）。');
    await expect(runPage.backLink).toHaveAttribute('href', '#/');
  });
});

test.describe('Case detail dialog', () => {
  test("fills the description with the run's test data and lists the data used", async ({ runPage }) => {
    await runPage.goto(RUNS.local);
    await runPage.openCell('TC07', 1);

    const { detail } = runPage;
    await expect(detail.root).toBeVisible();
    await expect(detail.caption).toHaveText('TC07 · 派彩與抽水（Payout）');
    await expect(detail.title).toHaveText(deployedText('TC07', 'title', 'zh-TW'));
    await expect(detail.summary).toHaveText('第 1 輪 · ✓ 通過 · 3.1 秒');
    await expect(detail.description).toHaveText(filledDescription('TC07', 'zh-TW', { amount: 200 }));
    await expect(detail.description.locator('strong.param-value').first()).toHaveText('200');
    await expect(detail.testDataValue('閒家下注金額')).toHaveText('200 自訂 預設：50');
    await expect(detail.note).toHaveText('這一輪的所有步驟都通過。');
    await expect(detail.reportLink).toHaveAttribute('href', `data/runs/${RUNS.local}/rounds/round-1/report/index.html#?testId=fixture-tc07`);
  });

  test('shows the error and the screenshot of a failed round', async ({ runPage }) => {
    await runPage.goto(RUNS.mixed);
    await runPage.openCell('TC10', 2);

    const { detail } = runPage;
    await expect(detail.status).toHaveText('✕ 失敗');
    await expect(detail.error).toContainText('Expected: "1"');
    await expect(detail.screenshot).toHaveAttribute('src', `data/runs/${RUNS.mixed}/rounds/round-2/shots/TC11.png`);
    // The image really loads from the published run folder.
    await expect(detail.screenshot).toHaveJSProperty('naturalWidth', 16);
    await expect(detail.testDataValue('對子邊注金額')).toHaveText('20');
  });

  test('explains a round blocked by the bot check', async ({ runPage }) => {
    await runPage.goto(RUNS.mixed);
    await runPage.openCell('TC06', 1);

    const { detail } = runPage;
    await expect(detail.status).toHaveText('– 略過');
    await expect(detail.summary.locator('.tag-blocked')).toHaveText('被擋下');
    await expect(detail.note).toContainText('外部網路驗證擋下了這次頁面載入');
    await expect(detail.testData).toHaveCount(0);
  });

  test('closes with the close button, Escape and a click on the backdrop', async ({ runPage }) => {
    await runPage.goto(RUNS.mixed);

    await runPage.openCell('TC14', 1);
    await runPage.detail.closeButton.click();
    await expect(runPage.detail.root).toBeHidden();

    await runPage.openCell('TC14', 2);
    await runPage.page.keyboard.press('Escape');
    await expect(runPage.detail.root).toBeHidden();

    await runPage.openCell('TC14', 3);
    await runPage.detail.root.click({ position: { x: 5, y: 5 } });
    await expect(runPage.detail.root).toBeVisible();
    await runPage.page.mouse.click(5, 5);
    await expect(runPage.detail.root).toBeHidden();
  });

  test('opens the case in the test console', async ({ runPage, consolePage }) => {
    await runPage.goto(RUNS.local);
    await runPage.openCell('TC07', 1);

    await expect(runPage.detail.consoleLink).toHaveText('在測試控制台查看／編輯');
    await runPage.detail.consoleLink.click();

    await expect(runPage.page).toHaveURL(/#\/console\/TC07$/);
    await expect(runPage.detail.root).toBeHidden();
    await expect(consolePage.caseBody('TC07')).toBeVisible();
    await expect(consolePage.caseItem('TC07')).toBeInViewport();
  });
});
