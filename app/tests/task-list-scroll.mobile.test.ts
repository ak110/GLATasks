/**
 * @fileoverview モバイル表示におけるタスク一覧の内部スクロール回帰テスト
 */

import { test, type Browser } from "@playwright/test";
import {
  BASE_URL,
  STORAGE_STATE_PATH,
  cleanupTestList,
} from "./helpers/common";
import {
  verifyAttachmentListKeepsTaskListAvailable,
  verifyTagListsKeepTaskListAvailable,
  verifyTaskListInternalScroll,
} from "./helpers/task-list-scroll";

const LIST_NAME = `モバイルスクロール_${Date.now()}`;

async function setupMobileTestList(
  browser: Browser,
  listName: string,
): Promise<void> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE_PATH,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await Promise.all([
    page.goto("/"),
    page.waitForResponse((response) => response.url().includes("/api/trpc")),
  ]);
  await page.fill('aside input[placeholder="新しいリスト"]', listName);
  await page.click('aside button[type="submit"]');
  await page
    .locator(`[data-testid="list-select-btn"]:has-text("${listName}")`)
    .waitFor({ state: "attached", timeout: 15000 });
  await context.close();
}

test.describe("task list scroll", () => {
  test.beforeAll(async ({ browser }) => {
    await setupMobileTestList(browser, LIST_NAME);
  });

  test.afterAll(async ({ browser }) => {
    await cleanupTestList(browser, LIST_NAME);
  });

  test.beforeEach(async ({ page }) => {
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
    await page.click(
      `[data-testid="list-select-btn"]:has-text("${LIST_NAME}")`,
    );
    await page
      .locator('[data-testid="task-add-form"]')
      .waitFor({ timeout: 15000 });
  });

  test("タスク一覧だけをスクロールし見出しと追加フォームを表示したままにする", async ({
    page,
  }) => {
    await verifyTaskListInternalScroll(page, LIST_NAME);
  });

  test("選択済み添付が上限件数でもタスク一覧を操作できる", async ({ page }) => {
    await verifyAttachmentListKeepsTaskListAvailable(page);
  });

  test("多数の現在タグと候補があってもタスク一覧を操作できる", async ({
    page,
  }) => {
    await verifyTagListsKeepTaskListAvailable(page);
  });

  test("添付とタグが上限件数でもタスク一覧を操作できる", async ({ page }) => {
    await verifyTagListsKeepTaskListAvailable(page, true);
  });
});
