import {
  uniqueTestName,
  addTask,
  createListFromPage,
  cleanupTestLists,
  setupTestLists,
  toggleTaskAndWaitForUpdate,
  waitForSuccessfulMutationResponse,
} from "./helpers/common";
import { test, expect, type Locator } from "@playwright/test";
/**
 * @fileoverview リスト CRUD の e2e テスト
 */

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

  test("編集と最前面の破棄確認でTabが循環し、Escape後にフォーカスが戻る", async ({
    page,
    browser,
  }) => {
    const listName = uniqueTestName("フォーカス確認");
    const taskTitle = uniqueTestName("フォーカス対象");
    await setupTestLists(browser, [listName]);
    try {
      await Promise.all([
        waitForSuccessfulMutationResponse(page, "lists.list"),
        page.reload(),
      ]);
      await page
        .getByTestId("list-select-btn")
        .filter({ hasText: listName })
        .click();
      const task = await addTask(page, taskTitle);
      const opener = task.getByTestId("task-edit-btn");
      await opener.click();
      const editor = page.getByRole("dialog", { name: "タスクの編集" });
      await expect(editor).toBeVisible();

      // 各方向にフォーカス可能な要素の数以上を2周し、背面へ移らないことを確かめる。
      async function cycleFocus(dialog: Locator) {
        const steps =
          2 *
          ((await dialog
            .locator('button, input, textarea, select, a[href], [tabindex="0"]')
            .count()) +
            1);
        for (const key of ["Tab", "Shift+Tab"]) {
          for (let step = 0; step < steps; step++) {
            await page.keyboard.press(key);
            await expect
              .poll(() =>
                dialog.evaluate((element) =>
                  element.contains(document.activeElement),
                ),
              )
              .toBe(true);
          }
        }
      }

      await cycleFocus(editor);
      await editor.getByLabel("内容").fill(`${taskTitle}変更`);
      await page.keyboard.press("Escape");
      const confirmation = page.getByRole("dialog", { name: "変更を破棄" });
      await expect(confirmation).toBeVisible();
      await cycleFocus(confirmation);
      await page.keyboard.press("Escape");
      await expect(confirmation).not.toBeVisible();
      await expect(editor).toBeVisible();
      await expect
        .poll(() =>
          editor.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        )
        .toBe(true);

      // 未保存の変更を戻して、編集ダイアログ自体をEscapeで閉じる。
      await editor.getByLabel("内容").fill(taskTitle);
      await page.keyboard.press("Escape");
      await expect(editor).not.toBeVisible();
      await expect(opener).toBeFocused();
    } finally {
      await cleanupTestLists(browser, [listName]);
    }
  });

  test("既存リストより名前が先行する新規リストのIDとタイトルが自動選択される", async ({
    page,
    browser,
  }) => {
    const stamp = uniqueTestName("自動選択");
    const existingName = `zz_${stamp}`;
    const createdName = `aa_${stamp}`;
    await setupTestLists(browser, [existingName]);
    try {
      await Promise.all([
        waitForSuccessfulMutationResponse(page, "lists.list"),
        page.reload(),
      ]);
      await page
        .getByTestId("list-select-btn")
        .filter({ hasText: existingName })
        .click();
      // 作成後の選択ボタンをクリックしない。作成そのものによる選択を検証する。
      await createListFromPage(page, createdName, false);
      await expect(
        page.getByRole("heading", { name: createdName, exact: true }),
      ).toBeVisible();
      const titles = await page
        .getByTestId("list-select-btn")
        .allTextContents();
      const createdIndex = titles.findIndex((title) =>
        title.includes(createdName),
      );
      const existingIndex = titles.findIndex((title) =>
        title.includes(existingName),
      );
      expect(createdIndex).toBeGreaterThanOrEqual(0);
      expect(existingIndex).toBeGreaterThan(createdIndex);

      // 公開編集フォームのリスト選択肢から作成IDを取得し、URLと実際の所属先を照合する。
      const task = await addTask(page, uniqueTestName("新規リスト所属"));
      await task.getByTestId("task-edit-btn").click();
      const editor = page.getByRole("dialog", { name: "タスクの編集" });
      const listSelect = editor.getByLabel("リスト", { exact: true });
      const createdId = await listSelect
        .locator("option")
        .filter({ hasText: createdName })
        .getAttribute("value");
      expect(createdId).toMatch(/^[1-9]\d*$/);
      expect(new URL(page.url()).hash).toBe(`#${createdId}`);
      await expect(listSelect).toHaveValue(createdId!);
      await page.keyboard.press("Escape");
      await expect(editor).not.toBeVisible();
    } finally {
      await cleanupTestLists(browser, [existingName, createdName]);
    }
  });

  test("リストを追加するとサイドバーに表示される", async ({ page }) => {
    const listName = `テストリスト_${uniqueTestName("e2e")}`;
    await createListFromPage(page, listName, false);
    await expect(
      page.locator(`[data-testid="list-select-btn"]:has-text("${listName}")`),
    ).toBeVisible({
      timeout: 15000,
    });
    await deleteListFromMenu(page, listName);
  });

  test("リストを選択するとサイドバーで選択状態になる", async ({ page }) => {
    const listName = `選択テスト_${uniqueTestName("e2e")}`;
    await createListFromPage(page, listName, false);
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
    const originalName = `名変テスト_${uniqueTestName("e2e")}`;
    const newName = `名変後_${uniqueTestName("e2e")}`;

    // リスト追加
    await createListFromPage(page, originalName, false);
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
    const listName = `削除テスト_${uniqueTestName("e2e")}`;

    // リスト追加
    await createListFromPage(page, listName, false);
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
    const stamp = uniqueTestName("e2e");
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
      await addTask(page, sourceTaskTitle);
      await targetList.getByTestId("list-select-btn").click();
      await addTask(page, targetTaskTitle);

      await sourceList.getByTestId("list-menu-btn").click();
      await page.getByRole("menuitem", { name: "他のリストに統合" }).click();
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

      const addedTask = await addTask(page, addedTaskTitle);
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
