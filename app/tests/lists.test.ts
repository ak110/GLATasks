/**
 * @fileoverview リスト CRUD の e2e テスト
 */

import { test, expect } from "@playwright/test";
import {
  cleanupTestLists,
  setupTestLists,
  toggleTaskAndWaitForUpdate,
  waitForPersistedTask,
  waitForSuccessfulMutationResponse,
} from "./helpers/common";

test.describe("lists", () => {
  test.beforeEach(async ({ page }) => {
    // SSE 接続が常時開いているため networkidle は利用できない。
    // goto + 初回 tRPC レスポンス待ちで hydration + データ取得完了を確保する。
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
  });

  /** ⋮ メニューから対象リストを削除する。後片付け用ヘルパー */
  async function deleteListFromMenu(
    page: import("@playwright/test").Page,
    listName: string,
  ) {
    const listRow = page
      .locator('[data-testid="list-item"]')
      .filter({ hasText: listName });
    await listRow.locator('[data-testid="list-menu-btn"]').click();
    await page.click('[data-testid="list-delete-btn"]');
    // ConfirmDialog の確認ボタン（「削除」テキスト）を押下する
    await page
      .locator('[role="dialog"] button:has-text("削除")')
      .last()
      .click();
  }

  async function addTaskToSelectedList(
    page: import("@playwright/test").Page,
    title: string,
  ) {
    const form = page.getByTestId("task-add-form");
    await form.locator("textarea").fill(title);
    const responsePromise = waitForSuccessfulMutationResponse(
      page,
      "tasks.create",
    );
    await form.locator('button[type="submit"]').click();
    await responsePromise;
    const taskRow = page.getByTestId("task-item").filter({ hasText: title });
    await expect(taskRow).toBeVisible({ timeout: 15000 });
    await waitForPersistedTask(taskRow);
    return taskRow;
  }

  test("リストを追加するとサイドバーに表示される", async ({ page }) => {
    const listName = `テストリスト_${Date.now()}`;
    await page.fill('aside input[placeholder="新しいリスト"]', listName);
    await page.click('aside button[type="submit"]');
    await expect(
      page.locator(`[data-testid="list-select-btn"]:has-text("${listName}")`),
    ).toBeVisible({
      timeout: 15000,
    });
    await deleteListFromMenu(page, listName);
  });

  test("リストを選択するとサイドバーで選択状態になる", async ({ page }) => {
    const listName = `選択テスト_${Date.now()}`;
    await page.fill('aside input[placeholder="新しいリスト"]', listName);
    await page.click('aside button[type="submit"]');
    await page
      .locator(`[data-testid="list-select-btn"]:has-text("${listName}")`)
      .waitFor({ timeout: 15000 });
    await page.click(`[data-testid="list-select-btn"]:has-text("${listName}")`);
    // リストが選択されるとタスク追加フォームが表示される
    await expect(page.locator('[data-testid="task-add-form"]')).toBeVisible({
      timeout: 15000,
    });
    await deleteListFromMenu(page, listName);
  });

  test("⋮ メニューから名前変更できる", async ({ page }) => {
    const originalName = `名変テスト_${Date.now()}`;
    const newName = `名変後_${Date.now()}`;

    // リスト追加
    await page.fill('aside input[placeholder="新しいリスト"]', originalName);
    await page.click('aside button[type="submit"]');
    await expect(
      page.locator(
        `[data-testid="list-select-btn"]:has-text("${originalName}")`,
      ),
    ).toBeVisible({ timeout: 15000 });

    // ⋮ メニューを開いて名前変更を選ぶ → PromptDialog の入力欄から確定する
    const listRow = page
      .locator('[data-testid="list-item"]')
      .filter({ hasText: originalName });
    await listRow.hover();
    await listRow.locator('[data-testid="list-menu-btn"]').click();
    await page.click('button:has-text("名前変更")');
    const dialogInput = page.locator('[role="dialog"] input[type="text"]');
    await dialogInput.fill(newName);
    await page.click('[role="dialog"] button:has-text("変更")');

    await expect(
      page.locator(`[data-testid="list-select-btn"]:has-text("${newName}")`),
    ).toBeVisible({ timeout: 15000 });

    await deleteListFromMenu(page, newName);
  });

  test("⋮ メニューから削除できる", async ({ page }) => {
    const listName = `削除テスト_${Date.now()}`;

    // リスト追加
    await page.fill('aside input[placeholder="新しいリスト"]', listName);
    await page.click('aside button[type="submit"]');
    await expect(
      page.locator(`[data-testid="list-select-btn"]:has-text("${listName}")`),
    ).toBeVisible({ timeout: 15000 });

    // ⋮ メニューから削除（ConfirmDialog 経由）
    const listRow = page
      .locator('[data-testid="list-item"]')
      .filter({ hasText: listName });
    await listRow.hover();
    await listRow.locator('[data-testid="list-menu-btn"]').click();
    await page.click('[data-testid="list-delete-btn"]');
    await page
      .locator('[role="dialog"] button:has-text("削除")')
      .last()
      .click();

    await expect(
      page.locator(`[data-testid="list-select-btn"]:has-text("${listName}")`),
    ).not.toBeVisible({ timeout: 15000 });
  });

  test("リスト統合後もタスクを追加して完了できる", async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    const sourceListName = `統合元_${stamp}`;
    const targetListName = `統合先_${stamp}`;
    const sourceTaskTitle = `統合元タスク_${stamp}`;
    const targetTaskTitle = `統合先タスク_${stamp}`;
    const addedTaskTitle = `統合後タスク_${stamp}`;
    await setupTestLists(browser, [sourceListName, targetListName]);

    try {
      await Promise.all([
        page.reload(),
        page.waitForResponse((response) =>
          response.url().includes("/api/trpc"),
        ),
      ]);
      const sourceList = page
        .getByTestId("list-item")
        .filter({ hasText: sourceListName });
      const targetList = page
        .getByTestId("list-item")
        .filter({ hasText: targetListName });

      await sourceList.getByTestId("list-select-btn").click();
      await addTaskToSelectedList(page, sourceTaskTitle);
      await targetList.getByTestId("list-select-btn").click();
      await addTaskToSelectedList(page, targetTaskTitle);

      await sourceList.getByTestId("list-menu-btn").click();
      await page.getByRole("button", { name: "他のリストに統合" }).click();
      const mergeDialog = page.getByRole("dialog", { name: "リストの統合" });
      await mergeDialog.getByLabel("統合先リスト").selectOption({
        label: targetListName,
      });
      const mergeResponsePromise = waitForSuccessfulMutationResponse(
        page,
        "lists.merge",
      );
      await mergeDialog.getByRole("button", { name: "統合" }).click();
      await mergeResponsePromise;

      await expect(sourceList).toHaveCount(0, { timeout: 15000 });
      await expect(
        page.getByTestId("task-item").filter({ hasText: sourceTaskTitle }),
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page.getByTestId("task-item").filter({ hasText: targetTaskTitle }),
      ).toBeVisible({ timeout: 15000 });

      const addedTask = await addTaskToSelectedList(page, addedTaskTitle);
      const checkbox = addedTask.locator('input[type="checkbox"]');
      await toggleTaskAndWaitForUpdate(page, checkbox);
      await toggleTaskAndWaitForUpdate(page, checkbox);
      await expect(addedTask.getByTestId("task-text")).toHaveClass(
        /line-through/,
      );
    } finally {
      await cleanupTestLists(browser, [sourceListName, targetListName]);
    }
  });
});
