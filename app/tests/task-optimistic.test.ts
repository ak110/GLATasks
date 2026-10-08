import {
  isTrpcUrl,
  uniqueTestName,
  createListFromPage,
  addTask,
  cleanupTestList,
  setupTestList,
  toggleTaskAndWaitForUpdate,
  waitForPersistedTask,
} from "./helpers/common";
import { test, expect, type Request, type Response } from "@playwright/test";
import { createConnection } from "mysql2/promise";
import { holdTaskCreate, dragTaskAfter } from "./helpers/task-page";
/**
 * @fileoverview タスク CRUD の e2e テスト
 */

const LIST_NAME = `タスクテスト_${uniqueTestName("e2e")}`;

test.describe("task-optimistic", () => {
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

  test("仮ID中は更新操作を抑止し、実ID確定後に解除する", async ({ page }) => {
    const gate = await holdTaskCreate(page);
    let createResponsePromise: Promise<Response> | undefined;
    let createStarted = false;
    let createFinished = false;
    try {
      const title = "仮ID操作_" + uniqueTestName("e2e");
      const form = page.getByTestId("task-add-form");
      createResponsePromise = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.create"),
      );
      await form.locator("textarea").fill(title);
      await form.locator('button[type="submit"]').click();
      createStarted = true;
      await gate.intercepted;

      const taskRow = page.getByTestId("task-item").filter({ hasText: title });
      await expect(taskRow).toBeVisible({ timeout: 15000 });
      await expect(taskRow).not.toHaveAttribute("data-reorder-id");
      const checkbox = taskRow.getByRole("checkbox");
      const editButton = taskRow.getByTestId("task-edit-btn");
      const dragHandle = taskRow.getByTestId("task-drag-handle");
      await expect(checkbox).toBeDisabled();
      await expect(editButton).toBeDisabled();
      await expect(dragHandle).toHaveAttribute("aria-disabled", "true");

      const updateRequests: Request[] = [];
      const onRequest = (request: Request) => {
        if (isTrpcUrl(request.url(), "tasks.update")) {
          updateRequests.push(request);
        }
      };
      page.on("request", onRequest);
      try {
        await checkbox.dispatchEvent("click");
        await editButton.dispatchEvent("click");
        await expect.poll(() => updateRequests.length).toBe(0);
      } finally {
        page.off("request", onRequest);
      }

      const dialog = page.getByRole("dialog");
      if ((await dialog.count()) > 0) {
        await dialog
          .last()
          .getByRole("button", { name: "閉じる", exact: true })
          .click();
      }

      gate.release();
      const createResponse = await createResponsePromise;
      createFinished = true;
      expect(createResponse.ok()).toBe(true);
      await waitForPersistedTask(taskRow);
      await expect(checkbox).toBeEnabled();
      await expect(editButton).toBeEnabled();
      await toggleTaskAndWaitForUpdate(page, checkbox);
    } finally {
      gate.release();
      if (createStarted && !createFinished) {
        await createResponsePromise?.catch(() => undefined);
      }
      await page.unroute("**/api/trpc/**");
    }
  });

  test("仮ID中も他タスクの並び替えが成功し、確定順序を維持する", async ({
    page,
    browser,
  }) => {
    const listName = "仮ID並び替え_" + uniqueTestName("e2e");
    await createListFromPage(page, listName);
    let gate: Awaited<ReturnType<typeof holdTaskCreate>> | undefined;
    let createResponsePromise: Promise<Response> | undefined;
    let createStarted = false;
    let createFinished = false;
    try {
      const stamp = uniqueTestName("e2e");
      const firstTitle = "A_" + stamp;
      const secondTitle = "B_" + stamp;
      const temporaryTitle = "C_" + stamp;
      await addTask(page, firstTitle);
      await addTask(page, secondTitle);

      gate = await holdTaskCreate(page);
      createResponsePromise = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.create"),
      );
      const form = page.getByTestId("task-add-form");
      await form.locator("textarea").fill(temporaryTitle);
      await form.locator('button[type="submit"]').click();
      createStarted = true;
      await gate.intercepted;

      const temporaryRow = page
        .getByTestId("task-item")
        .filter({ hasText: temporaryTitle });
      await expect(temporaryRow).toBeVisible({ timeout: 15000 });
      await expect(temporaryRow).not.toHaveAttribute("data-reorder-id");
      await expect(page.getByTestId("task-item")).toHaveCount(3);

      await dragTaskAfter(page, secondTitle, firstTitle);
      const items = page.getByTestId("task-item");
      await expect(items.nth(0)).toContainText(temporaryTitle);
      await expect(items.nth(1)).toContainText(firstTitle);
      await expect(items.nth(2)).toContainText(secondTitle);

      gate.release();
      const createResponse = await createResponsePromise;
      createFinished = true;
      expect(createResponse.ok()).toBe(true);
      await waitForPersistedTask(temporaryRow);
      await expect(items.nth(0)).toContainText(temporaryTitle);
      await expect(items.nth(1)).toContainText(firstTitle);
      await expect(items.nth(2)).toContainText(secondTitle);
    } finally {
      gate?.release();
      if (createStarted && !createFinished) {
        await createResponsePromise?.catch(() => undefined);
      }
      await page.unroute("**/api/trpc/**");
      await cleanupTestList(browser, listName);
    }
  });

  test("仮ID中の作成失敗で並び替え結果を巻き戻さない", async ({
    page,
    browser,
  }) => {
    const listName = "仮ID失敗競合_" + uniqueTestName("e2e");
    await createListFromPage(page, listName);
    let gate: Awaited<ReturnType<typeof holdTaskCreate>> | undefined;
    let createResponsePromise: Promise<Response> | undefined;
    let createStarted = false;
    let createFinished = false;
    try {
      const stamp = uniqueTestName("e2e");
      const firstTitle = "A_" + stamp;
      const secondTitle = "B_" + stamp;
      const temporaryTitle = "C_" + stamp;
      await addTask(page, firstTitle);
      await addTask(page, secondTitle);

      gate = await holdTaskCreate(page, 500);
      createResponsePromise = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.create"),
      );
      const form = page.getByTestId("task-add-form");
      await form.locator("textarea").fill(temporaryTitle);
      await form.locator('button[type="submit"]').click();
      createStarted = true;
      await gate.intercepted;

      const temporaryRow = page
        .getByTestId("task-item")
        .filter({ hasText: temporaryTitle });
      await expect(temporaryRow).toBeVisible({ timeout: 15000 });
      await dragTaskAfter(page, secondTitle, firstTitle);
      const items = page.getByTestId("task-item");
      await expect(items.nth(0)).toContainText(temporaryTitle);
      await expect(items.nth(1)).toContainText(firstTitle);
      await expect(items.nth(2)).toContainText(secondTitle);

      gate.release();
      const createResponse = await createResponsePromise;
      createFinished = true;
      expect(createResponse.status()).toBe(500);
      await expect(temporaryRow).toHaveCount(0);
      await expect(items).toHaveCount(2);
      await expect(items.nth(0)).toContainText(firstTitle);
      await expect(items.nth(1)).toContainText(secondTitle);
    } finally {
      gate?.release();
      if (createStarted && !createFinished) {
        await createResponsePromise?.catch(() => undefined);
      }
      await page.unroute("**/api/trpc/**");
      await cleanupTestList(browser, listName);
    }
  });

  test("仮ID対応後も更新失敗で並び替え結果を巻き戻さない", async ({
    page,
    browser,
  }) => {
    const listName = "更新失敗競合_" + uniqueTestName("e2e");
    await createListFromPage(page, listName);
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let updateStarted = false;
    let updateFinished = false;
    let updateResponsePromise: Promise<Response> | undefined;
    try {
      const stamp = uniqueTestName("e2e");
      const firstTitle = "A_" + stamp;
      const secondTitle = "B_" + stamp;
      await addTask(page, firstTitle);
      await addTask(page, secondTitle);

      let notifyIntercepted!: () => void;
      const intercepted = new Promise<void>((resolve) => {
        notifyIntercepted = resolve;
      });
      await page.route("**/api/trpc/**", async (route) => {
        if (!isTrpcUrl(route.request().url(), "tasks.update")) {
          await route.continue();
          return;
        }
        notifyIntercepted();
        await released;
        await route.fulfill({ status: 500 });
      });

      const secondRow = page
        .getByTestId("task-item")
        .filter({ hasText: secondTitle });
      updateResponsePromise = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.update"),
      );
      await secondRow.getByRole("checkbox").click();
      updateStarted = true;
      await intercepted;

      await dragTaskAfter(page, secondTitle, firstTitle);
      const items = page.getByTestId("task-item");
      await expect(items.nth(0)).toContainText(firstTitle);
      await expect(items.nth(1)).toContainText(secondTitle);

      release();
      const updateResponse = await updateResponsePromise;
      updateFinished = true;
      expect(updateResponse.status()).toBe(500);
      await expect(page.getByTestId("toast-error")).toBeVisible();
      await expect(items.nth(0)).toContainText(firstTitle);
      await expect(items.nth(1)).toContainText(secondTitle);
    } finally {
      release();
      if (updateStarted && !updateFinished) {
        await updateResponsePromise?.catch(() => undefined);
      }
      await page.unroute("**/api/trpc/**");
      await cleanupTestList(browser, listName);
    }
  });

  test("単独の更新失敗で楽観値を変更前へ復元する", async ({
    page,
    browser,
  }) => {
    const listName = "単独更新失敗_" + uniqueTestName("e2e");
    await createListFromPage(page, listName);
    let releaseUpdate!: () => void;
    const updateReleased = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    try {
      const title = "更新失敗復元_" + uniqueTestName("e2e");
      await addTask(page, title);
      let notifyUpdateIntercepted!: () => void;
      const updateIntercepted = new Promise<void>((resolve) => {
        notifyUpdateIntercepted = resolve;
      });
      await page.route("**/api/trpc/**", async (route) => {
        if (isTrpcUrl(route.request().url(), "tasks.update")) {
          notifyUpdateIntercepted();
          await updateReleased;
          await route.fulfill({ status: 500 });
          return;
        }
        await route.continue();
      });

      const taskRow = page.getByTestId("task-item").filter({ hasText: title });
      const checkbox = taskRow.getByRole("checkbox");
      const updateResponse = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.update"),
      );
      await checkbox.dispatchEvent("click");
      await updateIntercepted;
      await expect(checkbox).toHaveJSProperty("indeterminate", true);
      releaseUpdate();
      expect((await updateResponse).status()).toBe(500);
      await expect(page.getByTestId("toast-error")).toBeVisible();
      await expect(checkbox).not.toBeChecked();
      await expect(checkbox).toHaveJSProperty("indeterminate", false);
    } finally {
      releaseUpdate();
      await page.unroute("**/api/trpc/**");
      await cleanupTestList(browser, listName);
    }
  });

  test("同期から時間が経過した既存タスクでも更新失敗で楽観値を復元する", async ({
    page,
    browser,
  }) => {
    const listName = "経過後更新失敗_" + uniqueTestName("e2e");
    await createListFromPage(page, listName);
    let releaseUpdate!: () => void;
    const updateReleased = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    try {
      const title = "経過後復元_" + uniqueTestName("e2e");
      await addTask(page, title);
      // DBの更新時刻を同期窓より前へ戻し、差分応答へ再掲されない状態にする。
      const row = page.getByTestId("task-item").filter({ hasText: title });
      const taskId = Number(await row.getAttribute("data-reorder-id"));
      const db = await createConnection(
        process.env.DATABASE_URL ??
          (() => {
            throw new Error("DATABASE_URL が必要です");
          })(),
      );
      try {
        await db.execute(
          "UPDATE task SET updated = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 SECOND) WHERE id = ?",
          [taskId],
        );
      } finally {
        await db.end();
      }
      // DBだけを古くするとキャッシュのupdatedと一致しないため、全件読込で一致させる。
      // この読込の同期時刻は、10秒前に戻した対象タスクのupdatedより後になる。
      const fixtureReloaded = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.listActive"),
      );
      await page.reload();
      expect((await fixtureReloaded).ok()).toBe(true);
      await page
        .getByTestId("list-select-btn")
        .filter({ hasText: listName })
        .click();
      await expect(row).toBeVisible();
      await expect(row.getByRole("checkbox")).toHaveJSProperty(
        "indeterminate",
        false,
      );

      let notifyUpdateIntercepted!: () => void;
      const updateIntercepted = new Promise<void>((resolve) => {
        notifyUpdateIntercepted = resolve;
      });
      await page.route("**/api/trpc/**", async (route) => {
        if (isTrpcUrl(route.request().url(), "tasks.update")) {
          notifyUpdateIntercepted();
          await updateReleased;
          await route.fulfill({ status: 500 });
          return;
        }
        await route.continue();
      });

      const taskRow = page.getByTestId("task-item").filter({ hasText: title });
      const checkbox = taskRow.getByRole("checkbox");
      const updateResponse = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.update"),
      );
      await checkbox.dispatchEvent("click");
      await updateIntercepted;
      await expect(checkbox).toHaveJSProperty("indeterminate", true);
      releaseUpdate();
      expect((await updateResponse).status()).toBe(500);
      await expect(page.getByTestId("toast-error")).toBeVisible();
      await expect(checkbox).not.toBeChecked();
      await expect(checkbox).toHaveJSProperty("indeterminate", false);
    } finally {
      releaseUpdate();
      await page.unroute("**/api/trpc/**");
      await cleanupTestList(browser, listName);
    }
  });

  test("先行更新が失敗しても後発の同一フィールド更新を維持する", async ({
    page,
    browser,
  }) => {
    const listName = "同一フィールド更新競合_" + uniqueTestName("e2e");
    await createListFromPage(page, listName);
    let releaseFirstUpdate!: () => void;
    const firstUpdateReleased = new Promise<void>((resolve) => {
      releaseFirstUpdate = resolve;
    });
    let failedUpdateResponse: Promise<Response> | undefined;
    try {
      const title = "連続更新_" + uniqueTestName("e2e");
      await addTask(page, title);

      let notifyFirstUpdateIntercepted!: () => void;
      const firstUpdateIntercepted = new Promise<void>((resolve) => {
        notifyFirstUpdateIntercepted = resolve;
      });
      let updateRequestCount = 0;
      await page.route("**/api/trpc/**", async (route) => {
        if (!isTrpcUrl(route.request().url(), "tasks.update")) {
          await route.continue();
          return;
        }
        updateRequestCount += 1;
        if (updateRequestCount === 1) {
          notifyFirstUpdateIntercepted();
          await firstUpdateReleased;
          await route.fulfill({ status: 500 });
          return;
        }
        await route.continue();
      });

      const taskRow = page.getByTestId("task-item").filter({ hasText: title });
      const checkbox = taskRow.getByRole("checkbox");
      failedUpdateResponse = page.waitForResponse(
        (response) =>
          isTrpcUrl(response.url(), "tasks.update") &&
          response.status() === 500,
      );
      await checkbox.dispatchEvent("click");
      await firstUpdateIntercepted;
      await expect(checkbox).toHaveJSProperty("indeterminate", true);

      const successfulUpdateResponse = page.waitForResponse(
        (response) =>
          isTrpcUrl(response.url(), "tasks.update") && response.ok(),
      );
      const successfulUpdateRefetch = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.listActive"),
      );
      await checkbox.dispatchEvent("click");
      expect((await successfulUpdateResponse).ok()).toBe(true);
      expect((await successfulUpdateRefetch).ok()).toBe(true);
      await expect(checkbox).toBeChecked();

      releaseFirstUpdate();
      expect((await failedUpdateResponse).status()).toBe(500);
      await expect(page.getByTestId("toast-error")).toBeVisible();
      await expect(checkbox).toBeChecked();
    } finally {
      releaseFirstUpdate();
      await failedUpdateResponse?.catch(() => undefined);
      await page.unroute("**/api/trpc/**");
      await cleanupTestList(browser, listName);
    }
  });

  test("同一内容の後発保存が成功した後に先行保存が失敗しても編集結果を維持する", async ({
    page,
    browser,
  }) => {
    const stamp = uniqueTestName("e2e");
    const sourceListName = `連続保存元_${stamp}`;
    const destinationListName = `連続保存先_${stamp}`;
    let releaseFirstUpdate!: () => void;
    const firstUpdateReleased = new Promise<void>((resolve) => {
      releaseFirstUpdate = resolve;
    });
    let failedUpdateResponse: Promise<Response> | undefined;
    try {
      await createListFromPage(page, sourceListName);
      const originalTitle = `連続保存前_${stamp}`;
      const editedTitle = `連続保存後_${stamp}`;
      const editedNotes = "同じ内容を続けて保存する";
      const tagName = `連続保存タグ_${stamp}`;
      await addTask(page, originalTitle);

      await createListFromPage(page, destinationListName);
      const destinationAnchorTitle = `移動先既存_${stamp}`;
      await addTask(page, destinationAnchorTitle);
      await page
        .getByTestId("list-select-btn")
        .filter({ hasText: sourceListName })
        .click();

      let notifyFirstUpdateIntercepted!: () => void;
      const firstUpdateIntercepted = new Promise<void>((resolve) => {
        notifyFirstUpdateIntercepted = resolve;
      });
      let updateRequestCount = 0;
      await page.route("**/api/trpc/**", async (route) => {
        if (!isTrpcUrl(route.request().url(), "tasks.update")) {
          await route.continue();
          return;
        }
        updateRequestCount += 1;
        if (updateRequestCount === 1) {
          notifyFirstUpdateIntercepted();
          await firstUpdateReleased;
          await route.fulfill({ status: 500 });
          return;
        }
        await route.continue();
      });

      const sourceTaskRow = page
        .getByTestId("task-item")
        .filter({ hasText: originalTitle });
      await sourceTaskRow.getByTestId("task-edit-btn").click();
      const dialog = page.getByRole("dialog", { name: "タスクの編集" });
      await dialog.getByLabel("内容").fill(`${editedTitle}\n\n${editedNotes}`);
      await dialog.getByTestId("tag-editor-input").fill(tagName);
      await dialog.getByTestId("tag-editor-add").click();
      await dialog.getByLabel("リスト").selectOption({
        label: destinationListName,
      });

      failedUpdateResponse = page.waitForResponse(
        (response) =>
          isTrpcUrl(response.url(), "tasks.update") &&
          response.status() === 500,
      );
      await dialog.getByTestId("task-edit-save-btn").click();
      await firstUpdateIntercepted;

      const successfulUpdateResponse = page.waitForResponse(
        (response) =>
          isTrpcUrl(response.url(), "tasks.update") && response.ok(),
      );
      const successfulUpdateRefetch = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.listActive"),
      );
      await dialog.getByTestId("task-edit-save-btn").click();
      expect((await successfulUpdateResponse).ok()).toBe(true);
      expect((await successfulUpdateRefetch).ok()).toBe(true);

      const failedUpdateRefetch = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.listActive"),
      );
      releaseFirstUpdate();
      expect((await failedUpdateResponse).status()).toBe(500);
      expect((await failedUpdateRefetch).ok()).toBe(true);
      await expect(page.getByTestId("toast-error")).toBeVisible();
      await dialog.getByRole("button", { name: "閉じる", exact: true }).click();

      await page
        .getByTestId("list-select-btn")
        .filter({ hasText: destinationListName })
        .click();
      const destinationItems = page.getByTestId("task-item");
      await expect(destinationItems.nth(0)).toContainText(editedTitle);
      const editedTaskRow = destinationItems.filter({ hasText: editedTitle });
      await expect(editedTaskRow).toContainText(editedNotes);
      await expect(
        editedTaskRow.getByTestId("task-tags").filter({ hasText: tagName }),
      ).toBeVisible();
      await expect(destinationItems.nth(1)).toContainText(
        destinationAnchorTitle,
      );
    } finally {
      releaseFirstUpdate();
      await failedUpdateResponse?.catch(() => undefined);
      await page.unroute("**/api/trpc/**");
      await cleanupTestList(browser, sourceListName);
      await cleanupTestList(browser, destinationListName);
    }
  });
});
