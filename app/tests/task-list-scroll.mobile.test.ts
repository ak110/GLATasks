import {
  setupTestList,
  uniqueTestName,
  cleanupTestList,
} from "./helpers/common";
import { test } from "@playwright/test";
import {
  verifyAttachmentListKeepsTaskListAvailable,
  verifyTagListsKeepTaskListAvailable,
  verifyTaskAdditionScrollsToTop,
  verifyTaskListInternalScroll,
} from "./helpers/task-list-scroll";
/**
 * @fileoverview モバイル表示におけるタスク一覧の内部スクロール回帰テスト
 */

const LIST_NAME = `モバイルスクロール_${uniqueTestName("e2e")}`;

test.describe("task list scroll", () => {
  test.beforeAll(async ({ browser }) => {
    await setupTestList(browser, LIST_NAME);
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

  test("タスク追加後に一覧先頭へ戻る", async ({ page }) => {
    await verifyTaskAdditionScrollsToTop(page);
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
