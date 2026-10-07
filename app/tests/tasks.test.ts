import {
  isTrpcUrl,
  uniqueTestName,
  cleanupTestList,
  setupTestList,
  toggleTaskAndWaitForUpdate,
  waitForSuccessfulMutationResponse,
  waitForPersistedTask,
} from "./helpers/common";
import { test, expect } from "@playwright/test";
import { createConnection } from "mysql2/promise";
/**
 * @fileoverview タスク CRUD の e2e テスト
 */

const LIST_NAME = `タスクテスト_${uniqueTestName("e2e")}`;

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
    const taskTitle = `タスク_${uniqueTestName("e2e")}`;
    await page.fill('textarea[placeholder*="タスクを追加"]', taskTitle);
    await page.click('[data-testid="task-add-form"] button[type="submit"]');
    await expect(
      page.locator('[data-testid="task-item"]').filter({ hasText: taskTitle }),
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("タスク追加後は入力欄が折りたたまれる", async ({ page }) => {
    const taskTitle = `折りたたみ_${uniqueTestName("e2e")}`;
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
    const title = `マルチライン_${uniqueTestName("e2e")}`;
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
    const taskTitle = `チェックテスト_${uniqueTestName("e2e")}`;
    await page.fill('textarea[placeholder*="タスクを追加"]', taskTitle);
    await page.click('[data-testid="task-add-form"] button[type="submit"]');
    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: taskTitle });
    await taskRow.waitFor({ timeout: 15000 });
    await waitForPersistedTask(taskRow);
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
    const taskTitle = `アンチェックテスト_${uniqueTestName("e2e")}`;
    await page.fill('textarea[placeholder*="タスクを追加"]', taskTitle);
    await page.click('[data-testid="task-add-form"] button[type="submit"]');
    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: taskTitle });
    await taskRow.waitFor({ timeout: 15000 });
    await waitForPersistedTask(taskRow);
    const checkbox = taskRow.locator('input[type="checkbox"]');
    await toggleTaskAndWaitForUpdate(page, checkbox);
    await toggleTaskAndWaitForUpdate(page, checkbox);
    await expect(
      taskRow.locator('[data-testid="task-text"].line-through'),
    ).toBeVisible({
      timeout: 15000,
    });
    await waitForPersistedTask(taskRow);
    await toggleTaskAndWaitForUpdate(page, checkbox);
    await expect(
      taskRow.locator('[data-testid="task-text"].line-through'),
    ).not.toBeVisible({
      timeout: 15000,
    });
  });

  test("チェックボックスはアーカイブ状態と未知状態からも操作できる", async ({
    page,
  }) => {
    const taskTitle = `旧状態テスト_${uniqueTestName("e2e")}`;
    await page.fill('textarea[placeholder*="タスクを追加"]', taskTitle);
    await page.click('[data-testid="task-add-form"] button[type="submit"]');
    const taskRow = page
      .getByTestId("task-item")
      .filter({ hasText: taskTitle });
    await waitForPersistedTask(taskRow);
    const taskId = Number(await taskRow.getAttribute("data-reorder-id"));
    expect(taskId).toBeGreaterThan(0);

    const db = await createConnection(
      process.env.DATABASE_URL ??
        (() => {
          throw new Error("DATABASE_URL が必要です");
        })(),
    );
    try {
      await db.execute("UPDATE task SET status = ? WHERE id = ?", [
        "archived",
        taskId,
      ]);
      await page.reload();
      await page
        .getByTestId("list-select-btn")
        .filter({ hasText: LIST_NAME })
        .click();
      await page.locator("header select").selectOption("archived");
      const archivedRow = page
        .getByTestId("task-item")
        .filter({ hasText: taskTitle });
      await expect(archivedRow).toBeVisible();
      const archivedUpdate = waitForSuccessfulMutationResponse(
        page,
        "tasks.update",
      );
      await archivedRow
        .locator('input[type="checkbox"]')
        .dispatchEvent("click");
      await archivedUpdate;
      await expect(archivedRow).toHaveCount(0);
      await page.locator("header select").selectOption("all");
      await expect(
        page
          .getByTestId("task-item")
          .filter({ hasText: taskTitle })
          .locator('input[type="checkbox"]'),
      ).toBeChecked();

      await db.execute("UPDATE task SET status = ? WHERE id = ?", [
        "unknown",
        taskId,
      ]);
      await page.reload();
      await page
        .getByTestId("list-select-btn")
        .filter({ hasText: LIST_NAME })
        .click();
      await page.locator("header select").selectOption("all");
      const unknownRow = page
        .getByTestId("task-item")
        .filter({ hasText: taskTitle });
      await expect(unknownRow).toBeVisible();
      const checkbox = unknownRow.locator('input[type="checkbox"]');
      await toggleTaskAndWaitForUpdate(page, checkbox);
      await expect(checkbox).toHaveJSProperty("indeterminate", true);
      await expect(checkbox).not.toBeChecked();
    } finally {
      await db.end();
    }
  });

  test("チェックボックスが実行中を経由して循環し、完了済み非表示の対象外になる", async ({
    page,
  }) => {
    const taskTitle = `実行中テスト_${uniqueTestName("e2e")}`;
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
        isTrpcUrl(response.url(), "lists.clear"),
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
    const title = `コピーテスト_${uniqueTestName("e2e")}`;
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
    const title = `全体コピー_${uniqueTestName("e2e")}`;
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
    const title = `タグテスト_${uniqueTestName("e2e")}`;
    const tagName = `ラベル_${uniqueTestName("e2e")}`;

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

  test("編集ダイアログでタグを追加できる", async ({ page }) => {
    const title = `タグ編集_${uniqueTestName("e2e")}`;
    const tagName = `編集タグ_${uniqueTestName("e2e")}`;

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
    const updateResponsePromise = waitForSuccessfulMutationResponse(
      page,
      "tasks.update",
    );
    await page.getByTestId("task-edit-save-btn").click();
    await updateResponsePromise;

    await expect(
      taskRow.locator('[data-testid="task-tags"]').filter({ hasText: tagName }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("編集ダイアログでテキストを変更できる", async ({ page }) => {
    const original = `編集前_${uniqueTestName("e2e")}`;
    const edited = `編集後_${uniqueTestName("e2e")}`;
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
    const updateResponsePromise = waitForSuccessfulMutationResponse(
      page,
      "tasks.update",
    );
    await page.getByTestId("task-edit-save-btn").click();
    await updateResponsePromise;
    await expect(
      page.locator('[data-testid="task-item"]').filter({ hasText: edited }),
    ).toBeVisible({
      timeout: 15000,
    });
  });
});
