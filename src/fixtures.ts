import { test as base, expect } from '@playwright/test';
import { BaccaratApi } from './api/baccaratApi';
import { TablePage } from './pages/TablePage';
import { TestData } from './support/testData';

type BaccaratFixtures = {
  sessionId: string;
  tablePage: TablePage;
  api: BaccaratApi;
  data: TestData;
};

export const test = base.extend<BaccaratFixtures>({
  sessionId: async ({}, use, testInfo) => {
    const id = `s-${testInfo.testId.slice(0, 8)}-${Date.now()}`;
    await use(id);
  },

  tablePage: async ({ page, sessionId }, use) => {
    const table = new TablePage(page, sessionId);
    await use(table);
  },

  api: async ({ page, request, sessionId, tablePage }, use) => {
    const client = new BaccaratApi(request, sessionId, async () => {
      if (page.url() !== 'about:blank') {
        await tablePage.sync();
      }
    });
    await tablePage.open();
    await client.reset(1000);
    await use(client);
  },

  data: async ({}, use, testInfo) => {
    const data = TestData.forTest(testInfo.title);
    testInfo.annotations.push({ type: 'test data', description: data.describe() });
    await use(data);
  },
});

export { expect };

export const softExpect = expect.configure({ soft: true });
