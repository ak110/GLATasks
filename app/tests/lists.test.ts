/**
 * @fileoverview リスト CRUD の e2e テスト
 */

import { test, expect } from "@playwright/test";

test.describe("lists", () => {
  test.beforeEach(async ({ page }) => {
    // SSE 接続が常時開いているため networkidle は使えない。
    // goto + 初回 tRPC レスポンス待ちで hydration + データ取得完了を確保する。
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
  });

  test("リストを追加するとサイドバーに表示される", async ({ page }) => {
    const listName = `テストリスト_${Date.now()}`;
    await page.fill('aside input[placeholder="新しいリスト"]', listName);
    await page.click('aside button[type="submit"]');
    await expect(
      page.locator(`[data-testid="list-select-btn"]:has-text("${listName}")`),
    ).toBeVisible({
      timeout: 15000,
    });
    // 後始末: 作成したリストを削除
    page.once("dialog", (dialog) => dialog.accept());
    const listRow = page
      .locator('[data-testid="list-item"]')
      .filter({ hasText: listName });
    await listRow.locator('[data-testid="list-menu-btn"]').click();
    await page.click('[data-testid="list-delete-btn"]');
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
    // 後始末: 作成したリストを削除
    page.once("dialog", (dialog) => dialog.accept());
    const listRow = page
      .locator('[data-testid="list-item"]')
      .filter({ hasText: listName });
    await listRow.locator('[data-testid="list-menu-btn"]').click();
    await page.click('[data-testid="list-delete-btn"]');
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

    // ⋮ メニューを開く
    const listRow = page
      .locator('[data-testid="list-item"]')
      .filter({ hasText: originalName });
    await listRow.hover();
    await listRow.locator('[data-testid="list-menu-btn"]').click();
    page.once("dialog", async (dialog) => {
      await dialog.accept(newName);
    });
    await page.click('button:has-text("名前変更")');

    await expect(
      page.locator(`[data-testid="list-select-btn"]:has-text("${newName}")`),
    ).toBeVisible({ timeout: 15000 });
  });

  test("⋮ メニューから削除できる", async ({ page }) => {
    const listName = `削除テスト_${Date.now()}`;

    // リスト追加
    await page.fill('aside input[placeholder="新しいリスト"]', listName);
    await page.click('aside button[type="submit"]');
    await expect(
      page.locator(`[data-testid="list-select-btn"]:has-text("${listName}")`),
    ).toBeVisible({ timeout: 15000 });

    // ⋮ メニューから削除
    const listRow = page
      .locator('[data-testid="list-item"]')
      .filter({ hasText: listName });
    await listRow.hover();
    await listRow.locator('[data-testid="list-menu-btn"]').click();
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.click('[data-testid="list-delete-btn"]');

    await expect(
      page.locator(`[data-testid="list-select-btn"]:has-text("${listName}")`),
    ).not.toBeVisible({ timeout: 15000 });
  });
});
