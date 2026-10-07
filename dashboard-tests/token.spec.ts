import { expect, test } from './fixtures/test';
import { FIXED_NOW } from './fixtures/clock';
import { OWNER, OWNER_TOKEN, REPO } from './fixtures/github-mock';
import { STORAGE_KEYS, type TokenEntry } from './fixtures/storage';

const OTHER_TOKEN = 'github_pat_11FIXTURE0_someoneElsesTokenNotTheOwner';

test.describe('GitHub token dialog', () => {
  test('opens when pressing Run without a token, links to the pre-filled GitHub form and focuses the input', async ({ consolePage }) => {
    await consolePage.goto();

    await expect(consolePage.tokenLine).toContainText('執行測試和儲存描述需要 GitHub token（只有 repo 擁有者有）。');
    await consolePage.runButton.click();

    const { tokenDialog } = consolePage;
    await expect(tokenDialog.root).toBeVisible();
    await expect(tokenDialog.heading).toHaveText('設定 GitHub token');
    await expect(tokenDialog.input).toBeFocused();
    await expect(tokenDialog.createTokenLink).toHaveAttribute('href', /https:\/\/github\.com\/settings\/personal-access-tokens\/new\?/);
    await expect(tokenDialog.createTokenLink).toHaveAttribute('href', new RegExp(`target_name=${REPO.owner}`));
    await expect(tokenDialog.createTokenLink).toHaveAttribute('href', /actions=write/);
    await expect(tokenDialog.createTokenLink).toHaveAttribute('href', /contents=write/);

    await tokenDialog.cancelButton.click();
    await expect(tokenDialog.root).toBeHidden();
  });

  test('rejects a malformed token locally and a token GitHub refuses', async ({ consolePage, github }) => {
    await consolePage.goto();
    await consolePage.tokenLine.locator('[data-act="token-setup"]').click();

    const { tokenDialog } = consolePage;
    await tokenDialog.submit('not-a-valid-token');
    await expect(tokenDialog.error).toHaveText('格式不對：token 應該是 github_pat_ 開頭的一串字');
    expect(github.calls('user')).toHaveLength(0);

    await tokenDialog.submit('github_pat_11FIXTURE0_unknownTokenRejectedByGitHub');
    await expect(tokenDialog.error).toHaveText('token 無效或已過期，請重新設定。');
    await expect(tokenDialog.saveButton).toBeEnabled();
    await expect(tokenDialog.saveButton).toHaveText('儲存並驗證');
    expect(github.calls('user')).toHaveLength(1);
  });

  test('verifies a valid token, stores it in sessionStorage by default and removes it on request', async ({ consolePage, github, storage }) => {
    await consolePage.goto();
    await consolePage.runButton.click();

    await consolePage.tokenDialog.submit(OWNER_TOKEN);

    await expect(consolePage.tokenDialog.root).toBeHidden();
    await expect(consolePage.tokenLine).toContainText(`已連結 GitHub 帳號 ${OWNER.login}`);
    await expect(consolePage.tokenLine).toContainText('關閉分頁後清除');
    await expect(consolePage.summary).not.toContainText('GitHub token');
    expect(github.lastCall('user').token).toBe(OWNER_TOKEN);

    await expect.poll(() => storage.read<TokenEntry>('session', STORAGE_KEYS.token)).toEqual({
      token: OWNER_TOKEN,
      login: OWNER.login,
      id: OWNER.id,
      expires: null,
      savedAt: FIXED_NOW.toISOString(),
    });
    await expect.poll(() => storage.read<TokenEntry>('local', STORAGE_KEYS.token)).toBeNull();

    await consolePage.tokenLine.locator('[data-act="token-remove"]').click();
    await expect(consolePage.tokenLine).toContainText('執行測試和儲存描述需要 GitHub token');
    await expect.poll(() => storage.read<TokenEntry>('session', STORAGE_KEYS.token)).toBeNull();
  });

  test('stores the token in localStorage when "remember on this device" is ticked', async ({ consolePage, storage }) => {
    await consolePage.goto();
    await consolePage.tokenLine.locator('[data-act="token-setup"]').click();

    await consolePage.tokenDialog.submit(OWNER_TOKEN, { remember: true });

    await expect(consolePage.tokenDialog.root).toBeHidden();
    await expect(consolePage.tokenLine).toContainText('記在這台裝置');
    await expect.poll(() => storage.read<TokenEntry>('local', STORAGE_KEYS.token)).toMatchObject({
      token: OWNER_TOKEN,
      login: OWNER.login,
    });
    await expect.poll(() => storage.read<TokenEntry>('session', STORAGE_KEYS.token)).toBeNull();
  });

  test('shows the expiry date and warns when a token expires soon or belongs to another user', async ({ consolePage, github, storage }) => {
    github.addToken(OTHER_TOKEN, { login: 'octocat', id: 999 });
    await storage.signIn({
      token: OTHER_TOKEN,
      login: 'octocat',
      id: 999,
      expires: '2026-10-10 08:00:00 UTC',
    });
    await consolePage.goto();

    await expect(consolePage.tokenLine).toContainText('已連結 GitHub 帳號 octocat · 2026年10月10日 到期');
    await expect(consolePage.tokenLine.locator('.tag-warn')).toHaveText([
      '快到期了',
      '這不是 repo 擁有者的帳號（octocat），可能沒有權限',
    ]);
  });
});
