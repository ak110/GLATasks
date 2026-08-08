/**
 * @fileoverview タスク CRUD の e2e テスト
 */

import {
  test,
  expect,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { BASE_URL, STORAGE_STATE_PATH, setupTestList } from "./helpers/common";

const LIST_NAME = `タスクテスト_${Date.now()}`;

async function cleanupTaskList(
  browser: Browser,
  listName: string,
): Promise<void> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE_PATH,
    ignoreHTTPSErrors: true,
  });
  try {
    const page = await context.newPage();
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((response) => response.url().includes("/api/trpc")),
    ]);
    const listRow = page.getByTestId("list-item").filter({ hasText: listName });
    await listRow.getByTestId("list-menu-btn").click();
    await page.getByTestId("list-delete-btn").click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "削除" })
      .click();
    await expect(listRow).toHaveCount(0);
  } finally {
    await context.close();
  }
}

const MINIMUM_TASK_ROWS = 18;

async function requireBoundingBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("要素の境界ボックスを取得できません");
  return box;
}

async function verifyTaskListInternalScroll(
  page: Page,
  listName: string,
): Promise<void> {
  const taskList = page.getByTestId("task-list-scroll");
  const taskItems = page.getByTestId("task-item");
  const form = page.getByTestId("task-add-form");
  const textarea = form.locator("textarea");
  const submitButton = form.locator('button[type="submit"]');
  const stamp = Date.now();

  for (let i = await taskItems.count(); i < MINIMUM_TASK_ROWS; i++) {
    const title = `スクロール_${stamp}_${i}`;
    await textarea.click();
    await textarea.fill(title);
    await expect(submitButton).toBeVisible();
    await submitButton.click();
    await expect(taskItems.filter({ hasText: title })).toBeVisible({
      timeout: 15000,
    });
  }

  const heading = page.getByRole("heading", { name: listName, exact: true });
  const firstTask = taskItems.first();
  await expect(heading).toBeVisible();
  await expect(form).toBeVisible();
  await expect(taskList).toBeVisible();

  await taskList.evaluate((element) => {
    element.scrollTop = 0;
  });
  const dimensions = await taskList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

  const headingBefore = await requireBoundingBox(heading);
  const formBefore = await requireBoundingBox(form);
  const firstTaskBefore = await requireBoundingBox(firstTask);

  await taskList.evaluate((element) => {
    element.scrollTop = Math.min(
      160,
      element.scrollHeight - element.clientHeight,
    );
  });
  await expect
    .poll(() => taskList.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);

  const headingAfter = await requireBoundingBox(heading);
  const formAfter = await requireBoundingBox(form);
  const firstTaskAfter = await requireBoundingBox(firstTask);
  expect(headingAfter.y).toBeCloseTo(headingBefore.y, 1);
  expect(formAfter.y).toBeCloseTo(formBefore.y, 1);
  expect(firstTaskAfter.y).toBeLessThan(firstTaskBefore.y);

  await textarea.focus();
  await expect(submitButton).toBeVisible();
  await expect(heading).toBeVisible();
  await expect(form).toBeVisible();
  await expect(taskList).toBeVisible();

  const expandedForm = await requireBoundingBox(form);
  const remainingList = await requireBoundingBox(taskList);
  expect(remainingList.height).toBeGreaterThan(0);
  expect(remainingList.y).toBeGreaterThanOrEqual(
    expandedForm.y + expandedForm.height - 1,
  );

  await page.getByTestId("search-input").fill(`該当なし_${stamp}`);
  await expect(page.locator("main")).toHaveCSS("overflow-y", "auto");
}

test.describe("tasks", () => {
  test.beforeAll(async ({ browser }) => {
    await setupTestList(browser, LIST_NAME);
  });

  test.afterAll(async ({ browser }) => {
    await cleanupTaskList(browser, LIST_NAME);
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
    await cleanupTaskList(page.context().browser()!, reorderListName);
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
