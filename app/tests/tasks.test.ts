/**
 * @fileoverview タスク CRUD の e2e テスト
 */

import { test, expect, type Page } from "@playwright/test";
import { cleanupTestList, setupTestList } from "./helpers/common";
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

async function holdTaskCreate(page: Page): Promise<{
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
    await route.continue();
  });

  return { intercepted, release };
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
    await taskRow.locator('input[type="checkbox"]').dispatchEvent("click");
    await taskRow.locator('input[type="checkbox"]').dispatchEvent("click");
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
    await taskRow.locator('input[type="checkbox"]').dispatchEvent("click");
    await taskRow.locator('input[type="checkbox"]').dispatchEvent("click");
    await expect(
      taskRow.locator('[data-testid="task-text"].line-through'),
    ).toBeVisible({
      timeout: 15000,
    });
    await page.waitForTimeout(500);
    await taskRow.locator('input[type="checkbox"]').dispatchEvent("click");
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

    await checkbox.dispatchEvent("click");
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

    await checkbox.dispatchEvent("click");
    await expect(checkbox).toBeChecked();
    await expect(taskRow.locator('[data-testid="task-text"]')).toHaveClass(
      /line-through/,
    );

    await checkbox.dispatchEvent("click");
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
        await checkbox.dispatchEvent("click");
        await expect(checkbox).toHaveJSProperty("indeterminate", true);
      }
      await checkbox.dispatchEvent("click");
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
    await taskRow
      .locator('[data-testid="task-edit-btn"]')
      .dispatchEvent("click");

    await page
      .locator('[role="dialog"] [data-testid="tag-editor-input"]')
      .fill(tagName);
    await page
      .locator('[role="dialog"] [data-testid="tag-editor-add"]')
      .click();
    await page.click('button:has-text("保存")');

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
      await Promise.all([
        submitBtn.click(),
        page.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);
      // 追加結果が一覧に反映されるまで待ってから次の追加に進む
      await expect(
        page.locator('[data-testid="task-item"]').filter({ hasText: t }),
      ).toBeVisible({ timeout: 15000 });
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
    const reorderResponse = page.waitForResponse((res) =>
      res.url().includes("/api/trpc"),
    );
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();
    await reorderResponse;

    // 期待順序: B, A, C（C を末尾に移動）
    await expect(items.nth(0)).toContainText(`B_${stamp}`, { timeout: 10000 });
    await expect(items.nth(1)).toContainText(`A_${stamp}`, { timeout: 10000 });
    await expect(items.nth(2)).toContainText(`C_${stamp}`, { timeout: 10000 });

    // 後片付け: 並び替え用リストを削除
    await cleanupTestList(page.context().browser()!, reorderListName);
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
    await page.waitForTimeout(500);
    await taskRow
      .locator('[data-testid="task-edit-btn"]')
      .dispatchEvent("click");
    await page.locator("#edit-text").waitFor({ timeout: 15000 });
    await page.locator("#edit-text").fill(edited);
    await page.click('button:has-text("保存")');
    await expect(
      page.locator('[data-testid="task-item"]').filter({ hasText: edited }),
    ).toBeVisible({
      timeout: 15000,
    });
  });
});
