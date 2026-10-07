import { expect, test } from './fixtures/test';
import { BETWEEN_TICKS, FIXED_NOW, POLL_INTERVAL_MS } from './fixtures/clock';
import { OWNER_TOKEN } from './fixtures/github-mock';
import { publishedRun } from './fixtures/results';
import { applicableCaseCount } from './fixtures/site';
import { STORAGE_KEYS, trackedRun, type TrackedRun } from './fixtures/storage';

test.describe('Run lifecycle', () => {
  test('dispatches the selected cases, rounds and custom test data, then polls for the new run', async ({ consolePage, clock, github, storage }) => {
    await storage.signIn();
    await consolePage.goto();
    await consolePage.selectOnly(['TC07', 'TC12']);
    await consolePage.setRounds(1);
    await consolePage.expand('TC07');
    await consolePage.setParam('TC07', 'amount', '200');
    const release = github.hold('dispatch');

    await consolePage.runButton.click();

    await expect(consolePage.runButton).toBeDisabled();
    await expect(consolePage.runButton).toHaveText('啟動中…');
    release();

    const run = await github.dispatchedRun();
    expect(github.dispatches()).toEqual([
      {
        ref: 'main',
        inputs: {
          rounds: '1',
          cases: 'TC07,TC12',
          params: JSON.stringify({ TC07: { amount: 200 } }),
          target: 'production',
        },
      },
    ]);
    expect(github.lastCall('dispatch')).toMatchObject({
      token: OWNER_TOKEN,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
      },
    });

    await clock.advanceUntil(async () => {
      await expect(consolePage.runPanel.root).toBeVisible(BETWEEN_TICKS);
    });
    expect(github.lastCall('listRuns').query).toEqual({ event: 'workflow_dispatch', per_page: '5' });

    await expect(consolePage.runPanel.heading).toContainText('排隊中');
    await expect(consolePage.runPanel.message).toHaveText(`production 2 / ${applicableCaseCount('production')} 條案例 × 1 輪`);
    await consolePage.runPanel.expectPhase('queued');
    await expect(consolePage.runPanel.logLink).toHaveAttribute('href', run.htmlUrl);
    await expect(consolePage.runButton).toBeDisabled();
    await expect(consolePage.summary.locator('.muted')).toHaveText('上一次執行還在進行中');

    await expect.poll(() => storage.read<TrackedRun>('local', STORAGE_KEYS.run)).toMatchObject({
      id: run.id,
      rounds: 1,
      target: 'production',
      caseCount: 2,
      customCases: 1,
      done: false,
    });
  });

  test('follows a run through its phases, resumes after a reload, shows the running banner on Home and publishes results', async ({
    consolePage,
    home,
    clock,
    github,
    siteData,
    storage,
    page,
  }) => {
    const run = github.addRun({
      id: '21000000004',
      runNumber: 4,
      rounds: 1,
      createdAt: new Date(FIXED_NOW.getTime() - 125_000),
    });
    run.startedAt = new Date(FIXED_NOW.getTime() - 125_000);
    run.moveTo('setup');

    await storage.signIn();
    await storage.followRun(trackedRun(run, { caseCount: 2, customCases: 1 }));
    await consolePage.goto();

    const { runPanel } = consolePage;
    await expect(runPanel.heading).toHaveText('執行 #4 · 執行中');
    await expect(runPanel.elapsed).toHaveText('2 分 5 秒');
    await runPanel.expectPhase('setup');

    run.moveTo('tests');
    await clock.advance(POLL_INTERVAL_MS);
    await runPanel.expectPhase('tests');

    // Navigating to Home shows the running banner and header badge.
    await home.goto();
    await expect(home.runningBanner).toBeVisible();
    await expect(home.runningBanner).toContainText('有一次執行正在進行：2 條案例 × 1 輪');
    await expect(home.runningBadge).toBeVisible();

    await home.runningBanner.click();
    await expect(page).toHaveURL(/#\/console$/);
    await runPanel.expectPhase('tests');

    // Reloading mid-run resumes tracking from localStorage.
    await page.reload();
    await runPanel.expectPhase('tests');

    run.moveTo('publish');
    await clock.advance(POLL_INTERVAL_MS);
    await runPanel.expectPhase('publish');

    run.moveTo('deploy');
    await clock.advance(POLL_INTERVAL_MS);
    await runPanel.expectPhase('deploy');

    // Publishing the run and finishing the workflow shows the final score and chips.
    const published = publishedRun({
      id: run.id,
      runNumber: run.runNumber,
      startedAt: run.createdAt,
      cases: [
        { id: 'TC07', statuses: ['passed'], params: { amount: 200 } },
        { id: 'TC12', statuses: ['failed'] },
      ],
    });
    await siteData.publish(published);
    run.testsFailed = true;
    run.moveTo('published');
    await clock.advance(POLL_INTERVAL_MS);

    await expect(runPanel.heading).toHaveText('執行 #4 · 完成');
    await expect(runPanel.passRate).toHaveText('50.0%');
    await expect(runPanel.resultCounts).toHaveText('通過 1 · 失敗 1');
    await expect(runPanel.chips).toHaveCount(2);
    await expect(runPanel.chip('TC07')).toContainText('TC07');
    await expect(runPanel.chip('TC07')).toHaveAttribute('title', new RegExp(`TC07 .* · 通過`));
    await expect(runPanel.chip('TC12')).toHaveAttribute('title', new RegExp(`TC12 .* · 失敗`));
    await expect(runPanel.viewResultsLink).toHaveAttribute('href', `#/run/${run.id}`);
    await expect(consolePage.runningBadge).toBeHidden();
    await expect(consolePage.runButton).toBeEnabled();
  });

  test('cancels a running workflow and dismisses the panel', async ({ consolePage, clock, github, storage }) => {
    const run = github.addRun({ id: '21000000005', runNumber: 5, rounds: 2 });
    run.moveTo('tests');

    await storage.signIn();
    await storage.followRun(trackedRun(run, { caseCount: 4 }));
    await consolePage.goto();

    await consolePage.runPanel.expectPhase('tests');
    await consolePage.runPanel.cancelButton.click();

    await github.expectCalls('cancelRun', 1);
    run.moveTo('cancelled');
    await clock.advance(POLL_INTERVAL_MS);

    await expect(consolePage.runPanel.root).toHaveClass(/run-panel-bad/);
    await expect(consolePage.runPanel.message).toHaveText('這次執行已取消。');
    await expect(consolePage.runButton).toBeEnabled();

    await consolePage.runPanel.dismissButton.click();
    await expect(consolePage.runPanel.root).toBeHidden();
    await expect.poll(() => storage.read('local', STORAGE_KEYS.run)).toBeNull();
  });

  test('reports a workflow that failed before publishing results and handles dispatch API errors', async ({
    consolePage,
    clock,
    github,
    storage,
  }) => {
    const run = github.addRun({ id: '21000000006', runNumber: 6, rounds: 1 });
    run.moveTo('broken');

    await storage.signIn();
    await storage.followRun(trackedRun(run, { caseCount: 3 }));
    await consolePage.goto();

    await clock.advanceUntil(async () => {
      await expect(consolePage.runPanel.root).toHaveClass(/run-panel-bad/, BETWEEN_TICKS);
    });
    await expect(consolePage.runPanel.message).toHaveText('這次執行沒有完成（Run 1 round(s)：failure），請到 GitHub 查看執行紀錄。');
    await consolePage.runPanel.dismissButton.click();

    // A 403 on dispatch shows the permission message in the summary bar.
    github.failNext('dispatch', 403, 'Resource not accessible by personal access token');
    await consolePage.runButton.click();
    await expect(consolePage.summary.locator('.ko')).toHaveText('這個 token 沒有這個 repo 的 Actions 權限，請確認 token 的設定。');

    // A 401 on dispatch clears the expired token and shows the unauthorized message.
    github.failNext('dispatch', 401, 'Bad credentials');
    await consolePage.runButton.click();
    await expect(consolePage.summary.locator('.ko')).toHaveText('token 無效或已過期，請重新設定。');
    await expect(consolePage.tokenLine).toContainText('執行測試和儲存描述需要 GitHub token');
  });
});
