/**
 * @fileoverview タスク CRUD の e2e テスト
 */

import {
  test,
  expect,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";
import {
  cleanupTestList,
  setupTestList,
  toggleTaskAndWaitForUpdate,
  waitForPersistedTask,
} from "./helpers/common";
import {
  verifyAttachmentListKeepsTaskListAvailable,
  prepareScrollableTaskList,
  scrollTaskListDown,
  verifyTagListsKeepTaskListAvailable,
  verifyTaskAdditionScrollsToTop,
  verifyTaskListInternalScroll,
} from "./helpers/task-list-scroll";

const LIST_NAME = `タスクテスト_${Date.now()}`;

function isTaskCreateUrl(url: string): boolean {
  return url.includes("/api/trpc/tasks.create");
}

function isTaskUpdateUrl(url: string): boolean {
  return url.includes("/api/trpc/tasks.update");
}

function isTaskReorderUrl(url: string): boolean {
  return url.includes("/api/trpc/tasks.reorder");
}

function isActiveTaskListUrl(url: string): boolean {
  return url.includes("/api/trpc/tasks.listActive");
}

async function createListFromPage(page: Page, listName: string): Promise<void> {
  await page.fill('aside input[placeholder="新しいリスト"]', listName);
  await page.click('aside button[type="submit"]');
  const listButton = page
    .getByTestId("list-select-btn")
    .filter({ hasText: listName });
  await listButton.waitFor({ timeout: 15000 });
  await listButton.click();
  await expect(
    page.getByRole("heading", { name: listName, exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByTestId("task-add-form").waitFor({ timeout: 15000 });
}

async function holdTaskCreate(
  page: Page,
  failureStatus?: number,
): Promise<{
  intercepted: Promise<void>;
  release: () => void;
}> {
  let notifyIntercepted!: () => void;
  let release!: () => void;
  const intercepted = new Promise<void>((resolve) => {
    notifyIntercepted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/trpc/**", async (route) => {
    if (!isTaskCreateUrl(route.request().url())) {
      await route.continue();
      return;
    }
    notifyIntercepted();
    await released;
    if (failureStatus === undefined) {
      await route.continue();
    } else {
      await route.fulfill({ status: failureStatus });
    }
  });

  return { intercepted, release };
}

async function addTaskAndWaitForPersist(
  page: Page,
  title: string,
): Promise<void> {
  const form = page.getByTestId("task-add-form");
  await form.locator("textarea").click();
  await form.locator("textarea").fill(title);
  const createResponsePromise = page.waitForResponse((response) =>
    isTaskCreateUrl(response.url()),
  );
  await form.locator('button[type="submit"]').click();
  const createResponse = await createResponsePromise;
  expect(createResponse.ok()).toBe(true);
  const taskRow = page.getByTestId("task-item").filter({ hasText: title });
  await expect(taskRow).toBeVisible({ timeout: 15000 });
  await waitForPersistedTask(taskRow);
}

async function dragTaskAfter(
  page: Page,
  sourceTitle: string,
  targetTitle: string,
): Promise<void> {
  const source = page.getByTestId("task-item").filter({ hasText: sourceTitle });
  const target = page.getByTestId("task-item").filter({ hasText: targetTitle });
  const handleBox = await source.getByTestId("task-drag-handle").boundingBox();
  const targetBox = await target.boundingBox();
  if (!handleBox || !targetBox) {
    throw new Error("並び替え対象の境界ボックスを取得できない");
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height - 5;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 20, startY + 20);
  const reorderResponsePromise = page.waitForResponse((response) =>
    isTaskReorderUrl(response.url()),
  );
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
  const reorderResponse = await reorderResponsePromise;
  expect(reorderResponse.ok()).toBe(true);
}

test.describe("tasks", () => {
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
      const title = "仮ID操作_" + Date.now();
      const form = page.getByTestId("task-add-form");
      createResponsePromise = page.waitForResponse((response) =>
        isTaskCreateUrl(response.url()),
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
        if (request.url().includes("/api/trpc/tasks.update")) {
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
    const listName = "仮ID並び替え_" + Date.now();
    await createListFromPage(page, listName);
    let gate: Awaited<ReturnType<typeof holdTaskCreate>> | undefined;
    let createResponsePromise: Promise<Response> | undefined;
    let createStarted = false;
    let createFinished = false;
    try {
      const stamp = Date.now();
      const firstTitle = "A_" + stamp;
      const secondTitle = "B_" + stamp;
      const temporaryTitle = "C_" + stamp;
      await addTaskAndWaitForPersist(page, firstTitle);
      await addTaskAndWaitForPersist(page, secondTitle);

      gate = await holdTaskCreate(page);
      createResponsePromise = page.waitForResponse((response) =>
        isTaskCreateUrl(response.url()),
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
    const listName = "仮ID失敗競合_" + Date.now();
    await createListFromPage(page, listName);
    let gate: Awaited<ReturnType<typeof holdTaskCreate>> | undefined;
    let createResponsePromise: Promise<Response> | undefined;
    let createStarted = false;
    let createFinished = false;
    try {
      const stamp = Date.now();
      const firstTitle = "A_" + stamp;
      const secondTitle = "B_" + stamp;
      const temporaryTitle = "C_" + stamp;
      await addTaskAndWaitForPersist(page, firstTitle);
      await addTaskAndWaitForPersist(page, secondTitle);

      gate = await holdTaskCreate(page, 500);
      createResponsePromise = page.waitForResponse((response) =>
        isTaskCreateUrl(response.url()),
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
    const listName = "更新失敗競合_" + Date.now();
    await createListFromPage(page, listName);
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let updateStarted = false;
    let updateFinished = false;
    let updateResponsePromise: Promise<Response> | undefined;
    try {
      const stamp = Date.now();
      const firstTitle = "A_" + stamp;
      const secondTitle = "B_" + stamp;
      await addTaskAndWaitForPersist(page, firstTitle);
      await addTaskAndWaitForPersist(page, secondTitle);

      let notifyIntercepted!: () => void;
      const intercepted = new Promise<void>((resolve) => {
        notifyIntercepted = resolve;
      });
      await page.route("**/api/trpc/**", async (route) => {
        if (!isTaskUpdateUrl(route.request().url())) {
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
        isTaskUpdateUrl(response.url()),
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
    const listName = "単独更新失敗_" + Date.now();
    await createListFromPage(page, listName);
    let releaseUpdate!: () => void;
    const updateReleased = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    try {
      const title = "更新失敗復元_" + Date.now();
      await addTaskAndWaitForPersist(page, title);
      let notifyUpdateIntercepted!: () => void;
      const updateIntercepted = new Promise<void>((resolve) => {
        notifyUpdateIntercepted = resolve;
      });
      await page.route("**/api/trpc/**", async (route) => {
        if (isTaskUpdateUrl(route.request().url())) {
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
        isTaskUpdateUrl(response.url()),
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
    const listName = "経過後更新失敗_" + Date.now();
    await createListFromPage(page, listName);
    let releaseUpdate!: () => void;
    const updateReleased = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    try {
      const title = "経過後復元_" + Date.now();
      await addTaskAndWaitForPersist(page, title);
      // 差分取得の since は直近の同期時刻から最大2秒の余裕を持つため、
      // 対象タスクが差分応答へ再掲されなくなるまで待つ。
      await page.waitForTimeout(2500);
      // 別タスクの追加で activeTasks を再取得し、同期時刻を対象タスクより後へ進める。
      await addTaskAndWaitForPersist(page, "同期契機_" + Date.now());

      let notifyUpdateIntercepted!: () => void;
      const updateIntercepted = new Promise<void>((resolve) => {
        notifyUpdateIntercepted = resolve;
      });
      await page.route("**/api/trpc/**", async (route) => {
        if (isTaskUpdateUrl(route.request().url())) {
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
        isTaskUpdateUrl(response.url()),
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
    const listName = "同一フィールド更新競合_" + Date.now();
    await createListFromPage(page, listName);
    let releaseFirstUpdate!: () => void;
    const firstUpdateReleased = new Promise<void>((resolve) => {
      releaseFirstUpdate = resolve;
    });
    let failedUpdateResponse: Promise<Response> | undefined;
    try {
      const title = "連続更新_" + Date.now();
      await addTaskAndWaitForPersist(page, title);

      let notifyFirstUpdateIntercepted!: () => void;
      const firstUpdateIntercepted = new Promise<void>((resolve) => {
        notifyFirstUpdateIntercepted = resolve;
      });
      let updateRequestCount = 0;
      await page.route("**/api/trpc/**", async (route) => {
        if (!isTaskUpdateUrl(route.request().url())) {
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
          isTaskUpdateUrl(response.url()) && response.status() === 500,
      );
      await checkbox.dispatchEvent("click");
      await firstUpdateIntercepted;
      await expect(checkbox).toHaveJSProperty("indeterminate", true);

      const successfulUpdateResponse = page.waitForResponse(
        (response) => isTaskUpdateUrl(response.url()) && response.ok(),
      );
      const successfulUpdateRefetch = page.waitForResponse((response) =>
        isActiveTaskListUrl(response.url()),
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
    const stamp = Date.now();
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
      await addTaskAndWaitForPersist(page, originalTitle);

      await createListFromPage(page, destinationListName);
      const destinationAnchorTitle = `移動先既存_${stamp}`;
      await addTaskAndWaitForPersist(page, destinationAnchorTitle);
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
        if (!isTaskUpdateUrl(route.request().url())) {
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
          isTaskUpdateUrl(response.url()) && response.status() === 500,
      );
      await dialog.getByTestId("task-edit-save-btn").click();
      await firstUpdateIntercepted;

      const successfulUpdateResponse = page.waitForResponse(
        (response) => isTaskUpdateUrl(response.url()) && response.ok(),
      );
      const successfulUpdateRefetch = page.waitForResponse((response) =>
        isActiveTaskListUrl(response.url()),
      );
      await dialog.getByTestId("task-edit-save-btn").click();
      expect((await successfulUpdateResponse).ok()).toBe(true);
      expect((await successfulUpdateRefetch).ok()).toBe(true);

      const failedUpdateRefetch = page.waitForResponse((response) =>
        isActiveTaskListUrl(response.url()),
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

  test("タスクを追加すると一覧に表示される", async ({ page }) => {
    const taskTitle = `タスク_${Date.now()}`;
    await page.fill('textarea[placeholder*="タスクを追加"]', taskTitle);
    await page.click('[data-testid="task-add-form"] button[type="submit"]');
    await expect(
      page.locator('[data-testid="task-item"]').filter({ hasText: taskTitle }),
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("タスク追加後は入力欄が折りたたまれる", async ({ page }) => {
    const taskTitle = `折りたたみ_${Date.now()}`;
    const form = page.locator('[data-testid="task-add-form"]');
    const submitBtn = form.locator('button[type="submit"]');
    await page.fill('textarea[placeholder*="タスクを追加"]', taskTitle);
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();
    await expect(
      page.locator('[data-testid="task-item"]').filter({ hasText: taskTitle }),
    ).toBeVisible({ timeout: 15000 });
    // 送信成功後は追加ボタンが非表示（expanded=false）に戻る
    await expect(submitBtn).toBeHidden({ timeout: 15000 });
  });

  test("複数行タスクを追加すると title/notes に分割される", async ({
    page,
  }) => {
    const title = `マルチライン_${Date.now()}`;
    const notes = "これはメモです";
    await page.fill(
      'textarea[placeholder*="タスクを追加"]',
      `${title}\n${notes}`,
    );
    await page.click('[data-testid="task-add-form"] button[type="submit"]');
    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: title });
    await expect(taskRow).toBeVisible({ timeout: 15000 });
    await expect(taskRow.locator(`p:has-text("${notes}")`)).toBeVisible({
      timeout: 15000,
    });
  });

  test("チェックボックスをオンにすると打ち消し線が表示される", async ({
    page,
  }) => {
    const taskTitle = `チェックテスト_${Date.now()}`;
    await page.fill('textarea[placeholder*="タスクを追加"]', taskTitle);
    await page.click('[data-testid="task-add-form"] button[type="submit"]');
    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: taskTitle });
    await taskRow.waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    const checkbox = taskRow.locator('input[type="checkbox"]');
    await toggleTaskAndWaitForUpdate(page, checkbox);
    await toggleTaskAndWaitForUpdate(page, checkbox);
    await expect(
      taskRow.locator('[data-testid="task-text"].line-through'),
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("チェックボックスをオフにすると打ち消し線が消える", async ({ page }) => {
    const taskTitle = `アンチェックテスト_${Date.now()}`;
    await page.fill('textarea[placeholder*="タスクを追加"]', taskTitle);
    await page.click('[data-testid="task-add-form"] button[type="submit"]');
    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: taskTitle });
    await taskRow.waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    const checkbox = taskRow.locator('input[type="checkbox"]');
    await toggleTaskAndWaitForUpdate(page, checkbox);
    await toggleTaskAndWaitForUpdate(page, checkbox);
    await expect(
      taskRow.locator('[data-testid="task-text"].line-through'),
    ).toBeVisible({
      timeout: 15000,
    });
    await page.waitForTimeout(500);
    await toggleTaskAndWaitForUpdate(page, checkbox);
    await expect(
      taskRow.locator('[data-testid="task-text"].line-through'),
    ).not.toBeVisible({
      timeout: 15000,
    });
  });

  test("チェックボックスが実行中を経由して循環し、完了済み非表示の対象外になる", async ({
    page,
  }) => {
    const taskTitle = `実行中テスト_${Date.now()}`;
    await page.fill('textarea[placeholder*="タスクを追加"]', taskTitle);
    await page.click('[data-testid="task-add-form"] button[type="submit"]');
    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: taskTitle });
    await taskRow.waitFor({ timeout: 15000 });
    const checkbox = taskRow.locator('input[type="checkbox"]');

    await toggleTaskAndWaitForUpdate(page, checkbox);
    await expect(checkbox).toHaveJSProperty("indeterminate", true);
    await expect(checkbox).not.toBeChecked();
    await expect(taskRow.locator('[data-testid="task-text"]')).not.toHaveClass(
      /line-through/,
    );

    await Promise.all([
      page.getByTitle("完了済みタスクを非表示にする").click(),
      page.waitForResponse((response) =>
        response.url().includes("/api/trpc/lists.clear"),
      ),
    ]);
    await expect(taskRow).toBeVisible();

    await toggleTaskAndWaitForUpdate(page, checkbox);
    await expect(checkbox).toBeChecked();
    await expect(taskRow.locator('[data-testid="task-text"]')).toHaveClass(
      /line-through/,
    );

    await toggleTaskAndWaitForUpdate(page, checkbox);
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toHaveJSProperty("indeterminate", false);
    await expect(taskRow.locator('[data-testid="task-text"]')).not.toHaveClass(
      /line-through/,
    );
  });

  test("コピーメニューでタイトルのみをコピーできる", async ({ page }) => {
    const title = `コピーテスト_${Date.now()}`;
    const notes = "ノート部分";
    await page.fill(
      'textarea[placeholder*="タスクを追加"]',
      `${title}\n${notes}`,
    );
    await page.click('[data-testid="task-add-form"] button[type="submit"]');

    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: title });
    await taskRow.waitFor({ timeout: 15000 });

    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);

    await taskRow
      .locator('[data-testid="task-copy-btn"]')
      .dispatchEvent("click");
    await taskRow
      .locator('[data-testid="task-copy-menu"]')
      .waitFor({ timeout: 15000 });
    await taskRow
      .locator('[data-testid="task-copy-title"]')
      .dispatchEvent("click");

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(title);
  });

  test("コピーメニューで全体をコピーするとタイトルとボディが空行で区切られる", async ({
    page,
  }) => {
    const title = `全体コピー_${Date.now()}`;
    const notes = "ノート部分";
    await page.fill(
      'textarea[placeholder*="タスクを追加"]',
      `${title}\n${notes}`,
    );
    await page.click('[data-testid="task-add-form"] button[type="submit"]');

    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: title });
    await taskRow.waitFor({ timeout: 15000 });

    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);

    await taskRow
      .locator('[data-testid="task-copy-btn"]')
      .dispatchEvent("click");
    await taskRow
      .locator('[data-testid="task-copy-menu"]')
      .waitFor({ timeout: 15000 });
    await taskRow
      .locator('[data-testid="task-copy-all"]')
      .dispatchEvent("click");

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(`${title}\n\n${notes}`);
  });

  test("新規タスクにタグを付けると一覧にバッジが表示される", async ({
    page,
  }) => {
    const title = `タグテスト_${Date.now()}`;
    const tagName = `ラベル_${Date.now()}`;

    await page.fill('textarea[placeholder*="タスクを追加"]', title);
    // フォーカス後にタグ入力欄を表示させる
    await page.locator('[data-testid="task-add-form"] textarea').focus();
    await page
      .locator('[data-testid="task-add-form"] [data-testid="tag-editor-input"]')
      .fill(tagName);
    await page
      .locator('[data-testid="task-add-form"] [data-testid="tag-editor-add"]')
      .click();
    await page.click('[data-testid="task-add-form"] button[type="submit"]');

    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: title });
    await taskRow.waitFor({ timeout: 15000 });
    await expect(
      taskRow.locator('[data-testid="task-tags"]').filter({ hasText: tagName }),
    ).toBeVisible({ timeout: 15000 });
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
    const title = `追加失敗_${Date.now()}`;

    await page.route("**/api/trpc/**", async (route) => {
      if (isTaskCreateUrl(route.request().url())) {
        await route.abort();
      } else {
        await route.continue();
      }
    });
    try {
      const failedRequest = page.waitForRequest((request) =>
        isTaskCreateUrl(request.url()),
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
    const otherListName = `追加中切替_${Date.now()}`;
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
        isTaskCreateUrl(response.url()),
      );
      const title = `切替中追加_${Date.now()}`;
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
    const otherListName = `追加中往復_${Date.now()}`;
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
        isTaskCreateUrl(response.url()),
      );
      const title = `往復中追加_${Date.now()}`;
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
        response.url().includes("/api/trpc/lists.clear"),
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

    const title = `アーカイブ中追加_${Date.now()}`;
    const form = page.getByTestId("task-add-form");
    await form.locator("textarea").fill(title);
    await Promise.all([
      form.locator('button[type="submit"]').click(),
      page.waitForResponse((response) => isTaskCreateUrl(response.url())),
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

  test("編集ダイアログでタグを追加できる", async ({ page }) => {
    const title = `タグ編集_${Date.now()}`;
    const tagName = `編集タグ_${Date.now()}`;

    await page.fill('textarea[placeholder*="タスクを追加"]', title);
    await page.click('[data-testid="task-add-form"] button[type="submit"]');

    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: title });
    await taskRow.waitFor({ timeout: 15000 });
    await waitForPersistedTask(taskRow);
    await taskRow
      .locator('[data-testid="task-edit-btn"]')
      .dispatchEvent("click");

    await page
      .locator('[role="dialog"] [data-testid="tag-editor-input"]')
      .fill(tagName);
    await page
      .locator('[role="dialog"] [data-testid="tag-editor-add"]')
      .click();
    await page.getByTestId("task-edit-save-btn").click();

    await expect(
      taskRow.locator('[data-testid="task-tags"]').filter({ hasText: tagName }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("ドラッグハンドルでタスクを並び替えできる", async ({ page }) => {
    // 並び替え用に専用リストへ切り替え（既存テストデータの順序に影響しないよう独立リストを用意）
    const reorderListName = `並び替え_${Date.now()}`;
    await page.fill('aside input[placeholder="新しいリスト"]', reorderListName);
    await page.click('aside button[type="submit"]');
    await page
      .locator(`[data-testid="list-select-btn"]:has-text("${reorderListName}")`)
      .waitFor({ timeout: 15000 });
    await page.click(
      `[data-testid="list-select-btn"]:has-text("${reorderListName}")`,
    );
    await page
      .locator('[data-testid="task-add-form"]')
      .waitFor({ timeout: 15000 });

    // タスクを 3 件追加（新規追加は先頭挿入仕様 → 表示順は C, B, A）
    const stamp = Date.now();
    const titles = [`A_${stamp}`, `B_${stamp}`, `C_${stamp}`];
    const textarea = page.locator('textarea[placeholder*="タスクを追加"]');
    const submitBtn = page.locator(
      '[data-testid="task-add-form"] button[type="submit"]',
    );
    for (const t of titles) {
      // submit 直後はフォームが折りたたまれて submit が非表示になるため、
      // 都度 textarea へフォーカスして再展開してから入力・送信する
      await textarea.click();
      await textarea.fill(t);
      await expect(submitBtn).toBeVisible({ timeout: 5000 });
      const createResponsePromise = page.waitForResponse((response) =>
        response.url().includes("/api/trpc/tasks.create"),
      );
      await submitBtn.click();
      const createResponse = await createResponsePromise;
      if (!createResponse.ok()) {
        throw new Error(
          `tasks.createがHTTP ${createResponse.status()}で失敗した`,
        );
      }
      // 追加結果が一覧に反映されるまで待ってから次の追加に進む
      const taskRow = page
        .locator('[data-testid="task-item"]')
        .filter({ hasText: t });
      await expect(taskRow).toBeVisible({ timeout: 15000 });
      await waitForPersistedTask(taskRow);
    }

    const items = page.locator('[data-testid="task-item"]');
    await expect(items).toHaveCount(3, { timeout: 15000 });
    // 初期順序: 先頭が C（最後に追加）、末尾が A
    await expect(items.first()).toContainText(`C_${stamp}`);
    await expect(items.last()).toContainText(`A_${stamp}`);

    // 先頭タスク（C）のハンドルを末尾タスク（A）の下端へドラッグ
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
    // ドラッグ閾値（既定 5px）を確実に超えるための明示的な中間移動
    await page.mouse.move(startX + 20, startY + 20);
    // 並び替え mutation の発射を mouse.up と同時に待機する
    const reorderResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/trpc/tasks.reorder"),
    );
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();
    const reorderResponse = await reorderResponsePromise;
    if (!reorderResponse.ok()) {
      throw new Error(
        `tasks.reorderがHTTP ${reorderResponse.status()}で失敗した`,
      );
    }

    // 期待順序: B, A, C（C を末尾に移動）
    await expect(items.nth(0)).toContainText(`B_${stamp}`, { timeout: 10000 });
    await expect(items.nth(1)).toContainText(`A_${stamp}`, { timeout: 10000 });
    await expect(items.nth(2)).toContainText(`C_${stamp}`, { timeout: 10000 });

    // 後片付け: 並び替え用リストを削除
    await cleanupTestList(page.context().browser()!, reorderListName);
  });

  test("ドラッグハンドルでタスクを別リストへ移動できる", async ({
    page,
    browser,
  }) => {
    const targetListName = `移動先_${Date.now()}`;
    const taskTitle = `別リスト移動_${Date.now()}`;
    await createListFromPage(page, targetListName);
    try {
      await page
        .getByTestId("list-select-btn")
        .filter({ hasText: LIST_NAME })
        .click();
      await expect(
        page.getByRole("heading", { name: LIST_NAME, exact: true }),
      ).toBeVisible({ timeout: 15000 });

      await addTaskAndWaitForPersist(page, taskTitle);
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
        isTaskUpdateUrl(response.url()),
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

  test("編集ダイアログでテキストを変更できる", async ({ page }) => {
    const original = `編集前_${Date.now()}`;
    const edited = `編集後_${Date.now()}`;
    await page.fill('textarea[placeholder*="タスクを追加"]', original);
    await page.click('[data-testid="task-add-form"] button[type="submit"]');

    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: original });
    await taskRow.waitFor({ timeout: 15000 });
    await waitForPersistedTask(taskRow);
    await taskRow
      .locator('[data-testid="task-edit-btn"]')
      .dispatchEvent("click");
    await page.locator("#edit-text").waitFor({ timeout: 15000 });
    await page.locator("#edit-text").fill(edited);
    await page.getByTestId("task-edit-save-btn").click();
    await expect(
      page.locator('[data-testid="task-item"]').filter({ hasText: edited }),
    ).toBeVisible({
      timeout: 15000,
    });
  });
});
