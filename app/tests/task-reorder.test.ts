import {
  isTrpcUrl,
  uniqueTestName,
  createListFromPage,
  addTask,
  cleanupTestList,
  setupTestList,
} from "./helpers/common";
import { test, expect } from "@playwright/test";
import { holdTaskReorder, performTaskDragAfter } from "./helpers/task-page";

const LIST_NAME = `タスクテスト_${uniqueTestName("e2e")}`;

test.describe("task-reorder", () => {
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

  test("ドラッグハンドルでタスクを並び替えできる", async ({ page }) => {
    const reorderListName = `並び替え_${uniqueTestName("e2e")}`;
    await createListFromPage(page, reorderListName);

    const stamp = uniqueTestName("e2e");
    const titles = [`A_${stamp}`, `B_${stamp}`, `C_${stamp}`];
    for (const title of titles) {
      await addTask(page, title);
    }

    const items = page.locator('[data-testid="task-item"]');
    await expect(items).toHaveCount(3, { timeout: 15000 });
    await expect(items.first()).toContainText(`C_${stamp}`);
    await expect(items.last()).toContainText(`A_${stamp}`);

    const handle = items.first().locator('[data-testid="task-drag-handle"]');
    const lastItem = items.last();
    const handleBox = await handle.boundingBox();
    const lastBox = await lastItem.boundingBox();
    if (!handleBox || !lastBox) throw new Error("bounding box not available");

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    const endX = lastBox.x + lastBox.width / 2;
    const endY = lastBox.y + lastBox.height - 5;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 20, startY + 20);
    const reorderResponsePromise = page.waitForResponse((response) =>
      isTrpcUrl(response.url(), "tasks.reorder"),
    );
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();
    const reorderResponse = await reorderResponsePromise;
    if (!reorderResponse.ok()) {
      throw new Error(
        `tasks.reorderがHTTP ${reorderResponse.status()}で失敗した`,
      );
    }

    await expect(items.nth(0)).toContainText(`B_${stamp}`, { timeout: 10000 });
    await expect(items.nth(1)).toContainText(`A_${stamp}`, { timeout: 10000 });
    await expect(items.nth(2)).toContainText(`C_${stamp}`, { timeout: 10000 });

    await cleanupTestList(page.context().browser()!, reorderListName);
  });

  test("並び替え失敗後に元の順へ戻る", async ({ page, browser }) => {
    const reorderListName = `並び替え失敗_${uniqueTestName("e2e")}`;
    const stamp = uniqueTestName("e2e");
    const titles = [`失敗A_${stamp}`, `失敗B_${stamp}`, `失敗C_${stamp}`];
    await createListFromPage(page, reorderListName);
    const gate = await holdTaskReorder(page);

    try {
      for (const title of titles) {
        await addTask(page, title);
      }
      const items = page.getByTestId("task-item");
      await expect(items.nth(0)).toContainText(titles[2]!);
      await expect(items.nth(1)).toContainText(titles[1]!);
      await expect(items.nth(2)).toContainText(titles[0]!);

      const reorderResponsePromise = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.reorder"),
      );
      await performTaskDragAfter(page, titles[2]!, titles[0]!);
      await gate.intercepted;
      await expect(items.nth(0)).toContainText(titles[1]!);
      await expect(items.nth(1)).toContainText(titles[0]!);
      await expect(items.nth(2)).toContainText(titles[2]!);

      gate.release();
      const reorderResponse = await reorderResponsePromise;
      expect(reorderResponse.status()).toBe(500);
      await expect(items.nth(0)).toContainText(titles[2]!, {
        timeout: 15000,
      });
      await expect(items.nth(1)).toContainText(titles[1]!);
      await expect(items.nth(2)).toContainText(titles[0]!);
    } finally {
      gate.release();
      await page.unroute("**/api/trpc/**");
      await cleanupTestList(browser, reorderListName);
    }
  });

  test("ドラッグハンドルでタスクを別リストへ移動できる", async ({
    page,
    browser,
  }) => {
    const targetListName = `移動先_${uniqueTestName("e2e")}`;
    const taskTitle = `別リスト移動_${uniqueTestName("e2e")}`;
    await createListFromPage(page, targetListName);
    try {
      await page
        .getByTestId("list-select-btn")
        .filter({ hasText: LIST_NAME })
        .click();
      await expect(
        page.getByRole("heading", { name: LIST_NAME, exact: true }),
      ).toBeVisible({ timeout: 15000 });

      await addTask(page, taskTitle);
      const sourceTask = page
        .getByTestId("task-item")
        .filter({ hasText: taskTitle });
      const handleBox = await sourceTask
        .getByTestId("task-drag-handle")
        .boundingBox();
      const targetList = page
        .getByTestId("list-item")
        .filter({ hasText: targetListName });
      await expect(targetList).toHaveAttribute("data-task-drop-list-id", /\d+/);
      await targetList.scrollIntoViewIfNeeded();
      const targetBox = await targetList.boundingBox();
      if (!handleBox || !targetBox) {
        throw new Error("タスク移動対象の境界ボックスを取得できない");
      }

      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;
      const targetX = targetBox.x + targetBox.width / 2;
      const targetY = targetBox.y + targetBox.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 20, startY + 20);
      const updateResponsePromise = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.update"),
      );
      await page.mouse.move(targetX, targetY, { steps: 10 });
      await expect(targetList).toHaveClass(/ring-blue-400/, {
        timeout: 5000,
      });
      await page.mouse.up();
      const updateResponse = await updateResponsePromise;
      expect(updateResponse.ok()).toBe(true);

      await expect(sourceTask).toHaveCount(0, { timeout: 15000 });

      await targetList.getByTestId("list-select-btn").click();
      await expect(page.getByTestId("task-item").first()).toContainText(
        taskTitle,
        { timeout: 15000 },
      );
    } finally {
      await cleanupTestList(browser, targetListName);
    }
  });
});
