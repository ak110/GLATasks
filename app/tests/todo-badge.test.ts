import {
  uniqueTestName,
  addTask,
  setupTestList,
  cleanupTestList,
  toggleTaskAndWaitForUpdate,
} from "./helpers/common";
import { test, expect } from "@playwright/test";
/**
 * @fileoverview TODO区分タスクの通知バッジ表示に関する e2e テスト
 *
 * 発火機構やスケジュールには依存せず、TODO区分タスクのCRUD操作のみで検証する。
 * バッジ件数はリスト単位の集計値であるため、他テストのタスクが残っていると
 * 件数アサーションが汚染される。そのためリストをテストごとに作成・削除し、
 * 集計対象をテスト単体に閉じる。
 */

test.describe("todo-badge", () => {
  let listName: string;

  test.beforeEach(async ({ page, browser }) => {
    listName = `TODOバッジテスト_${uniqueTestName("e2e")}`;
    await setupTestList(browser, listName);
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
    await page.click(`[data-testid="list-select-btn"]:has-text("${listName}")`);
    await page
      .locator('[data-testid="task-add-form"]')
      .waitFor({ timeout: 15000 });
  });

  test.afterEach(async ({ browser }) => {
    await cleanupTestList(browser, listName);
  });

  function badgeLocator(page: import("@playwright/test").Page) {
    return page
      .locator('[data-testid="list-item"]')
      .filter({ hasText: listName })
      .locator('[data-testid="todo-badge"]');
  }

  test("TODOタスク作成でバッジが表示される", async ({ page }) => {
    const title = `TODO作成_${uniqueTestName("e2e")}`;
    await addTask(page, title, { todo: true });
    await expect(badgeLocator(page)).toHaveText("1", { timeout: 15000 });
  });

  test("TODOタスク完了でバッジ件数が減少し0件で非表示になる", async ({
    page,
  }) => {
    const title = `TODO完了_${uniqueTestName("e2e")}`;
    await addTask(page, title, { todo: true });
    await expect(badgeLocator(page)).toBeVisible({ timeout: 15000 });

    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: title });
    const checkbox = taskRow.locator('input[type="checkbox"]');
    await toggleTaskAndWaitForUpdate(page, checkbox);
    await toggleTaskAndWaitForUpdate(page, checkbox);
    await expect(badgeLocator(page)).not.toBeVisible({ timeout: 15000 });
  });

  test("完了済みTODOタスクのチェックを外すとバッジが復活する", async ({
    page,
  }) => {
    const title = `TODO復活_${uniqueTestName("e2e")}`;
    await addTask(page, title, { todo: true });
    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: title });
    const checkbox = taskRow.locator('input[type="checkbox"]');
    await toggleTaskAndWaitForUpdate(page, checkbox);
    await toggleTaskAndWaitForUpdate(page, checkbox);
    await expect(badgeLocator(page)).not.toBeVisible({ timeout: 15000 });

    await toggleTaskAndWaitForUpdate(page, checkbox);
    await expect(badgeLocator(page)).toHaveText("1", { timeout: 15000 });
  });

  test("通常タスクのみのリストはバッジが表示されない", async ({ page }) => {
    const title = `通常タスク_${uniqueTestName("e2e")}`;
    await addTask(page, title, { todo: false });
    await expect(
      page.locator('[data-testid="task-item"]').filter({ hasText: title }),
    ).toBeVisible({ timeout: 15000 });
    await expect(badgeLocator(page)).not.toBeVisible({ timeout: 15000 });
  });
});
