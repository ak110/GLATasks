import {
  isTrpcUrl,
  uniqueTestName,
  createListFromPage,
  cleanupTestList,
  setupTestList,
  toggleTaskAndWaitForUpdate,
} from "./helpers/common";
import { test, expect } from "@playwright/test";
import {
  verifyAttachmentListKeepsTaskListAvailable,
  prepareScrollableTaskList,
  scrollTaskListDown,
  verifyTagListsKeepTaskListAvailable,
  verifyTaskAdditionScrollsToTop,
  verifyTaskListInternalScroll,
} from "./helpers/task-list-scroll";
import { holdTaskCreate } from "./helpers/task-page";
/**
 * @fileoverview タスク CRUD の e2e テスト
 */

const LIST_NAME = `タスクテスト_${uniqueTestName("e2e")}`;

test.describe("task-scroll", () => {
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
    // リスト選択後、タスク追加フォームが表示されるのを待つ
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

  test("すべて表示でタスク追加後に一覧先頭へ戻る", async ({ page }) => {
    await page.locator("header select").selectOption("all");
    await verifyTaskAdditionScrollsToTop(page);
  });

  test("タスク追加に失敗した場合は一覧位置を維持する", async ({ page }) => {
    await prepareScrollableTaskList(page);
    await scrollTaskListDown(page);
    const form = page.getByTestId("task-add-form");
    const title = `追加失敗_${uniqueTestName("e2e")}`;

    await page.route("**/api/trpc/**", async (route) => {
      if (isTrpcUrl(route.request().url(), "tasks.create")) {
        await route.abort();
      } else {
        await route.continue();
      }
    });
    try {
      const failedRequest = page.waitForRequest((request) =>
        isTrpcUrl(request.url(), "tasks.create"),
      );
      await form.locator("textarea").fill(title);
      await form.locator('button[type="submit"]').click();
      await failedRequest;
      await expect(page.getByTestId("toast-error")).toBeVisible();
      await expect(
        page.getByTestId("task-item").filter({ hasText: title }),
      ).toHaveCount(0);
      await expect
        .poll(() =>
          page
            .getByTestId("task-list-scroll")
            .evaluate((element) => element.scrollTop),
        )
        .toBeGreaterThan(0);
    } finally {
      await page.unroute("**/api/trpc/**");
    }
  });

  test("タスク追加完了時に別リストを表示している場合は一覧位置を維持する", async ({
    page,
    browser,
  }) => {
    const otherListName = `追加中切替_${uniqueTestName("e2e")}`;
    await createListFromPage(page, otherListName);
    try {
      await prepareScrollableTaskList(page);
      await page
        .getByTestId("list-select-btn")
        .filter({ hasText: LIST_NAME })
        .click();
      await prepareScrollableTaskList(page);
      await scrollTaskListDown(page);

      const { intercepted, release } = await holdTaskCreate(page);
      const createResponse = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.create"),
      );
      const title = `切替中追加_${uniqueTestName("e2e")}`;
      let createStarted = false;
      let createFinished = false;
      try {
        const form = page.getByTestId("task-add-form");
        await form.locator("textarea").fill(title);
        await form.locator('button[type="submit"]').click();
        createStarted = true;
        await intercepted;
        await page
          .getByTestId("list-select-btn")
          .filter({ hasText: otherListName })
          .click();
        await scrollTaskListDown(page);
        release();
        await createResponse;
        createFinished = true;

        await expect(
          page.getByTestId("task-item").filter({ hasText: title }),
        ).toHaveCount(0);
        await expect
          .poll(() =>
            page
              .getByTestId("task-list-scroll")
              .evaluate((element) => element.scrollTop),
          )
          .toBeGreaterThan(0);
      } finally {
        release();
        if (createStarted && !createFinished) {
          await createResponse.catch(() => undefined);
        }
        await page.unroute("**/api/trpc/**");
      }
    } finally {
      await cleanupTestList(browser, otherListName);
    }
  });

  test("タスク追加完了前に追加先リストへ戻った場合は一覧先頭へ戻る", async ({
    page,
    browser,
  }) => {
    const otherListName = `追加中往復_${uniqueTestName("e2e")}`;
    await createListFromPage(page, otherListName);
    try {
      await prepareScrollableTaskList(page);
      await page
        .getByTestId("list-select-btn")
        .filter({ hasText: LIST_NAME })
        .click();
      await prepareScrollableTaskList(page);
      await scrollTaskListDown(page);

      const { intercepted, release } = await holdTaskCreate(page);
      const createResponse = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.create"),
      );
      const title = `往復中追加_${uniqueTestName("e2e")}`;
      let createStarted = false;
      let createFinished = false;
      try {
        const form = page.getByTestId("task-add-form");
        await form.locator("textarea").fill(title);
        await form.locator('button[type="submit"]').click();
        createStarted = true;
        await intercepted;
        await page
          .getByTestId("list-select-btn")
          .filter({ hasText: otherListName })
          .click();
        await page
          .getByTestId("list-select-btn")
          .filter({ hasText: LIST_NAME })
          .click();
        await scrollTaskListDown(page);
        release();
        await createResponse;
        createFinished = true;

        await expect(page.getByTestId("task-item").first()).toContainText(
          title,
          { timeout: 15000 },
        );
        await expect
          .poll(() =>
            page
              .getByTestId("task-list-scroll")
              .evaluate((element) => element.scrollTop),
          )
          .toBe(0);
      } finally {
        release();
        if (createStarted && !createFinished) {
          await createResponse.catch(() => undefined);
        }
        await page.unroute("**/api/trpc/**");
      }
    } finally {
      await cleanupTestList(browser, otherListName);
    }
  });

  test("アーカイブ表示でタスク追加した場合は一覧位置を維持する", async ({
    page,
  }) => {
    await prepareScrollableTaskList(page);
    const taskItems = page.getByTestId("task-item");
    const taskCount = await taskItems.count();
    const taskIds = await taskItems.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-reorder-id")),
    );
    for (let index = 0; index < taskCount; index++) {
      const checkbox = taskItems.nth(index).getByRole("checkbox");
      if (await checkbox.isChecked()) continue;
      const isRunning = await checkbox.evaluate(
        (element: HTMLInputElement) => element.indeterminate,
      );
      if (!isRunning) {
        await toggleTaskAndWaitForUpdate(page, checkbox);
      }
      await toggleTaskAndWaitForUpdate(page, checkbox);
      await expect(checkbox).toBeChecked();
    }
    await Promise.all([
      page.getByTitle("完了済みタスクを非表示にする").click(),
      page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "lists.clear"),
      ),
    ]);
    await expect(taskItems).toHaveCount(0, { timeout: 15000 });

    await page.locator("header select").selectOption("archived");
    for (const taskId of taskIds) {
      if (taskId === null) throw new Error("task reorder ID is missing");
      await expect(
        page.locator(`[data-testid="task-item"][data-reorder-id="${taskId}"]`),
      ).toBeVisible({ timeout: 15000 });
    }
    await scrollTaskListDown(page);

    const title = `アーカイブ中追加_${uniqueTestName("e2e")}`;
    const form = page.getByTestId("task-add-form");
    await form.locator("textarea").fill(title);
    await Promise.all([
      form.locator('button[type="submit"]').click(),
      page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.create"),
      ),
    ]);
    await expect(taskItems.filter({ hasText: title })).toHaveCount(0);
    await expect
      .poll(() =>
        page
          .getByTestId("task-list-scroll")
          .evaluate((element) => element.scrollTop),
      )
      .toBeGreaterThan(0);
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
