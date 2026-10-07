import { expect, test } from './fixtures/test';
import { OWNER_TOKEN } from './fixtures/github-mock';
import { STORAGE_KEYS, type Draft } from './fixtures/storage';
import { applicableCaseCount, catalogCase, deployedText, estimateMinutes, filledDescription, moduleCases, siteCatalog, type Target } from './fixtures/site';

const NEEDS_TOKEN = '按「執行」時會請你設定 GitHub token';
const caseCount = () => siteCatalog().cases.length;
const defaultCaseCount = () => applicableCaseCount('production');
/** The selection part of the run bar, e.g. "2 / 20 條案例 × 1 輪 · 約 3 分鐘 · 引擎：production". */
const selectionText = (cases: number, rounds: number, target: Target = 'production') =>
  `${cases} / ${applicableCaseCount(target)} 條案例 × ${rounds} 輪 · 約 ${estimateMinutes(cases, rounds)} 分鐘 · 引擎：${target}`;

test.describe('Test console', () => {
  test('lists every catalog case by module with its title, description and test data', async ({ consolePage }) => {
    await consolePage.goto();

    await expect(consolePage.heading).toHaveText('執行測試');
    await expect(consolePage.caseItems).toHaveCount(caseCount());
    await expect(consolePage.moduleNames()).toHaveText([
      '補牌規則（Tableau）',
      '派彩與抽水（Payout）',
      '單一錢包與併發（Wallet）',
      '桌台路單與 10 萬局 RTP（Table & RTP）',
    ]);
    await expect(consolePage.caseName('TC07')).toHaveText(deployedText('TC07', 'title', 'zh-TW'));
    await expect(consolePage.caseBody('TC07')).toBeHidden();

    await consolePage.expand('TC07');
    await expect(consolePage.expandButton('TC07')).toHaveAttribute('aria-expanded', 'true');
    await expect(consolePage.description('TC07')).toHaveText(filledDescription('TC07', 'zh-TW'));
    await expect(consolePage.param('TC07', 'amount')).toHaveValue('50');
    await expect(consolePage.caseBody('TC07')).toContainText('預設：50 · 範圍 10～1000 · 桌台限紅 $10 – $5,000');
    const { file, line } = catalogCase('TC07');
    await expect(consolePage.caseBody('TC07').getByRole('link', { name: '在 GitHub 查看這條案例的程式碼 ↗' })).toHaveAttribute(
      'href',
      `https://github.com/NTCloudy/baccarat-e2e-dashboard/blob/main/${file}#L${line}`,
    );

    await consolePage.expand('TC01');
    await expect(consolePage.caseBody('TC01')).toContainText('這條案例沒有可以調整的測試資料。');
  });

  test('shows the latest titles and descriptions from GitHub instead of the deployed ones', async ({ consolePage, github }) => {
    github.editDescriptions((docs) => {
      docs.TC01.title['zh-TW'] = '例牌 8 / 9 點即定勝負（GitHub 最新）';
      docs.TC07.description['zh-TW'] = '閒家下注 {amount} 勝出 1:1 派彩';
    });
    await consolePage.goto();
    await consolePage.expand('TC07');

    await expect(consolePage.caseName('TC01')).toHaveText('例牌 8 / 9 點即定勝負（GitHub 最新）');
    await expect(consolePage.description('TC07')).toHaveText('閒家下注 50 勝出 1:1 派彩');
    // Without a token, the public file is read anonymously.
    expect(github.lastCall('getFile')).toMatchObject({ token: null, query: { ref: 'main' } });
  });

  test('reads the latest descriptions anonymously when the token may not read them', async ({ consolePage, github, storage }) => {
    github.account(OWNER_TOKEN).contents = 'none';
    github.editDescriptions((docs) => {
      docs.TC01.title['zh-TW'] = '例牌 8 / 9 點即定勝負（GitHub 最新）';
    });
    await storage.signIn();
    await consolePage.goto();

    await expect(consolePage.caseName('TC01')).toHaveText('例牌 8 / 9 點即定勝負（GitHub 最新）');
    expect(github.calls('getFile').map((call) => call.token)).toEqual([OWNER_TOKEN, null]);
  });

  test('keeps the deployed descriptions when GitHub refuses to answer', async ({ consolePage, github, page }) => {
    github.editDescriptions((docs) => {
      docs.TC01.title['zh-TW'] = '例牌 8 / 9 點即定勝負（GitHub 最新）';
    });
    github.failNext('getFile', 403, 'API rate limit exceeded for 203.0.113.7.');
    const refused = page.waitForResponse((response) => response.url().includes('/contents/config/descriptions.json'));
    await consolePage.goto();
    expect((await refused).status()).toBe(403);

    await expect(consolePage.caseName('TC01')).toHaveText(deployedText('TC01', 'title', 'zh-TW'));
    await expect(consolePage.runButton).toBeEnabled();
  });

  test('summarizes the selection in the run bar and blocks the run without any case', async ({ consolePage }) => {
    await consolePage.goto();

    await expect(consolePage.summary).toHaveText(`${selectionText(defaultCaseCount(), 3)} · ${NEEDS_TOKEN}`);
    await expect(consolePage.runButton).toBeEnabled();

    await consolePage.selectNoneButton.click();
    await expect(consolePage.summary.locator('.ko')).toHaveText('請至少勾選一條測試案例');
    await expect(consolePage.runButton).toBeDisabled();

    await consolePage.caseCheckbox('TC07').check();
    await consolePage.caseCheckbox('TC12').check();
    await consolePage.setRounds(1);
    await expect(consolePage.summary).toHaveText(`${selectionText(2, 1)} · ${NEEDS_TOKEN}`);
    await expect(consolePage.runButton).toBeEnabled();

    await consolePage.selectAllButton.click();
    await expect(consolePage.root.locator('input[data-act="toggle-case"]:checked')).toHaveCount(defaultCaseCount());
  });

  test('switches target between production and with-bugs and updates the target note', async ({ consolePage }) => {
    await consolePage.goto();

    await expect(consolePage.target).toHaveValue('production');
    await expect(consolePage.targetNote).toContainText('標準引擎（production）');

    await consolePage.setTarget('with-bugs');

    await expect(consolePage.targetNote).toContainText('預先植入 12 個博奕高風險缺陷');
    await expect(consolePage.summary).toHaveText(`${selectionText(applicableCaseCount('with-bugs'), 3, 'with-bugs')} · ${NEEDS_TOKEN}`);
  });

  test('shows a partly selected module as indeterminate and toggles a whole module at once', async ({ consolePage }) => {
    const payout = moduleCases('Payout');
    await consolePage.goto();
    await consolePage.selectOnly(['TC07']);

    await expect(consolePage.moduleCheckbox('Payout')).toHaveJSProperty('indeterminate', true);
    await expect(consolePage.moduleCheckbox('Payout')).not.toBeChecked();
    await expect(consolePage.moduleCount('Payout')).toHaveText(`已選 1 / ${payout.length}`);
    await expect(consolePage.moduleCheckbox('Tableau')).toHaveJSProperty('indeterminate', false);
    await expect(consolePage.moduleCount('Tableau')).toHaveText(`已選 0 / ${moduleCases('Tableau').length}`);

    await consolePage.moduleCheckbox('Payout').click();
    await expect(consolePage.moduleCheckbox('Payout')).toBeChecked();
    await expect(consolePage.moduleCheckbox('Payout')).toHaveJSProperty('indeterminate', false);
    await expect(consolePage.moduleCount('Payout')).toHaveText(`已選 ${payout.length} / ${payout.length}`);
    await expect(consolePage.summary).toHaveText(`${selectionText(payout.length, 3)} · ${NEEDS_TOKEN}`);

    await consolePage.moduleCheckbox('Payout').click();
    await expect(consolePage.moduleCount('Payout')).toHaveText(`已選 0 / ${payout.length}`);
    await expect(consolePage.summary.locator('.ko')).toHaveText('請至少勾選一條測試案例');
  });

  test('updates the description, custom tag and run bar while test data is typed', async ({ consolePage, storage }) => {
    await storage.signIn();
    await consolePage.goto();
    await consolePage.expand('TC07');
    await expect(consolePage.summary).toHaveText(selectionText(defaultCaseCount(), 3));
    await expect(consolePage.customTag('TC07')).toBeHidden();
    await expect(consolePage.resetParamButton('TC07', 'amount')).toBeHidden();

    await consolePage.setParam('TC07', 'amount', '200');

    await expect(consolePage.description('TC07')).toHaveText(filledDescription('TC07', 'zh-TW', { amount: 200 }));
    await expect(consolePage.description('TC07').locator('strong.param-value').first()).toHaveText('200');
    await expect(consolePage.customTag('TC07')).toHaveText('自訂');
    await expect(consolePage.customTag('TC07')).toBeVisible();
    await expect(consolePage.resetParamButton('TC07', 'amount')).toBeVisible();
    await expect(consolePage.summary).toHaveText(`${selectionText(defaultCaseCount(), 3)} · 1 條用了自訂測試資料`);
  });

  test('restores the defaults of one field, one case or every case', async ({ consolePage }) => {
    await consolePage.goto();
    await consolePage.expand('TC07');
    await consolePage.expand('TC08');
    await consolePage.setParam('TC07', 'amount', '200');
    await consolePage.setParam('TC08', 'amount', '100');
    await expect(consolePage.summary).toContainText('2 條用了自訂測試資料');

    await consolePage.resetParamButton('TC07', 'amount').click();
    await expect(consolePage.param('TC07', 'amount')).toHaveValue('50');
    await expect(consolePage.customTag('TC07')).toBeHidden();

    await consolePage.resetCaseButton('TC08').click();
    await expect(consolePage.param('TC08', 'amount')).toHaveValue('35');
    await expect(consolePage.customTag('TC08')).toBeHidden();

    await consolePage.setParam('TC07', 'amount', '300');
    await consolePage.setParam('TC08', 'amount', '100');
    await consolePage.resetAllButton.click();
    await expect(consolePage.param('TC07', 'amount')).toHaveValue('50');
    await expect(consolePage.param('TC08', 'amount')).toHaveValue('35');
    await expect(consolePage.root.locator('[data-custom-tag]:visible')).toHaveCount(0);
    await expect(consolePage.summary).toHaveText(`${selectionText(defaultCaseCount(), 3)} · ${NEEDS_TOKEN}`);
  });

  test('remembers the selection, rounds and test data after a reload', async ({ consolePage, storage, page }) => {
    await consolePage.goto();
    await consolePage.selectOnly(['TC07', 'TC08']);
    await consolePage.setRounds(2);
    await consolePage.expand('TC07');
    await consolePage.setParam('TC07', 'amount', '200');
    await expect
      .poll(() => storage.read<Draft>('local', STORAGE_KEYS.draft))
      .toEqual({ rounds: 2, target: 'production', selected: ['TC07', 'TC08'], values: { TC07: { amount: '200' } } });

    await page.reload();

    await expect(consolePage.caseCheckbox('TC07')).toBeChecked();
    await expect(consolePage.caseCheckbox('TC08')).toBeChecked();
    await expect(consolePage.root.locator('input[data-act="toggle-case"]:checked')).toHaveCount(2);
    await expect(consolePage.rounds).toHaveValue('2');
    await expect(consolePage.customTag('TC07')).toBeVisible();
    await consolePage.expand('TC07');
    await expect(consolePage.param('TC07', 'amount')).toHaveValue('200');
    await expect(consolePage.summary).toHaveText(`${selectionText(2, 2)} · 1 條用了自訂測試資料 · ${NEEDS_TOKEN}`);
  });

  test('drops remembered choices that are no longer valid', async ({ consolePage, storage }) => {
    await storage.rememberDraft({ rounds: 42, selected: ['TC07', 'TC99'], values: { TC07: { amount: 99999 }, TC08: { amount: 100 } } });
    await consolePage.goto();

    await expect(consolePage.rounds).toHaveValue('3');
    await expect(consolePage.root.locator('input[data-act="toggle-case"]:checked')).toHaveCount(1);
    await expect(consolePage.caseCheckbox('TC07')).toBeChecked();
    await expect(consolePage.customTag('TC07')).toBeHidden();
    await expect(consolePage.customTag('TC08')).toBeVisible();
    await consolePage.expand('TC08');
    await expect(consolePage.param('TC08', 'amount')).toHaveValue('100');
  });
});

/** Invalid test data: the edits to make, the field that gets the error, the message, and an edit that fixes it. */
const INVALID_DATA: { name: string; caseId: string; edits: [string, string][]; field: string; error: string; fix: [string, string] }[] = [
  { name: 'a wager above the maximum', caseId: 'TC07', edits: [['amount', '1500']], field: 'amount', error: '不能大於 1000', fix: ['amount', '500'] },
  { name: 'a wager below the minimum', caseId: 'TC07', edits: [['amount', '5']], field: 'amount', error: '不能小於 10', fix: ['amount', '100'] },
  { name: 'a decimal wager', caseId: 'TC07', edits: [['amount', '25.5']], field: 'amount', error: '請輸入整數', fix: ['amount', '25'] },
  {
    name: 'concurrent requests above the maximum',
    caseId: 'TC14',
    edits: [['concurrency', '20']],
    field: 'concurrency',
    error: '不能大於 10',
    fix: ['concurrency', '5'],
  },
  {
    name: 'concurrent requests below the minimum',
    caseId: 'TC14',
    edits: [['concurrency', '1']],
    field: 'concurrency',
    error: '不能小於 2',
    fix: ['concurrency', '5'],
  },
];

test.describe('Test data validation', () => {
  for (const { name, caseId, edits, field, error, fix } of INVALID_DATA) {
    test(`rejects ${name} and blocks the run until it is fixed`, async ({ consolePage }) => {
      await consolePage.goto();
      await consolePage.expand(caseId);
      for (const [key, value] of edits) await consolePage.setParam(caseId, key, value);

      await expect(consolePage.paramError(caseId, field)).toHaveText(error);
      await expect(consolePage.param(caseId, field)).toHaveAttribute('aria-invalid', 'true');
      await expect(consolePage.errorTag(caseId)).toHaveText('需修正');
      await expect(consolePage.errorTag(caseId)).toBeVisible();
      await expect(consolePage.summary.locator('.ko')).toHaveText('有 1 個欄位需要修正');
      await expect(consolePage.runButton).toBeDisabled();

      await consolePage.setParam(caseId, ...fix);

      await expect(consolePage.paramError(caseId, field)).toBeHidden();
      await expect(consolePage.param(caseId, field)).toHaveAttribute('aria-invalid', 'false');
      await expect(consolePage.errorTag(caseId)).toBeHidden();
      await expect(consolePage.runButton).toBeEnabled();
    });
  }
});
