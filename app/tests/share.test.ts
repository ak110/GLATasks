/**
 * @fileoverview share/ingest ページの e2e テスト
 */

import { test, expect } from "@playwright/test";
import { setupTestList, cleanupTestList } from "./helpers/common";

const LIST_NAME = `shareテスト_${Date.now()}`;

test.describe("share/ingest", () => {
  test.beforeAll(async ({ browser }) => {
    // POST テスト用にリストを1つ作成しておく
    await setupTestList(browser, LIST_NAME);
  });

  test.afterAll(async ({ browser }) => {
    await cleanupTestList(browser, LIST_NAME);
  });

  test("title と url を渡すとフォームに初期値が表示される", async ({
    page,
  }) => {
    const title = "テストページ";
    const url = "https://example.com/test";
    await page.goto(
      `/share/ingest?title=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`,
    );
    await expect(page.locator("h1")).toHaveText("タスクを追加");
    const textareaValue = await page.locator("#text").inputValue();
    expect(textareaValue).toContain(title);
    expect(textareaValue).toContain(url);
  });

  test("閉じるボタンが存在しない", async ({ page }) => {
    await page.goto("/share/ingest?title=test");
    await expect(page.locator('button:has-text("閉じる")')).not.toBeVisible();
  });

  test("フォームを送信するとメインページへリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/share/ingest?title=ingestテスト");
    // リストが選択肢として現れるまで待機
    await expect(page.locator("#list_id option")).not.toHaveCount(0, {
      timeout: 10000,
    });
    await page.locator("#list_id").selectOption({ index: 0 });
    await page.click('button[type="submit"]');
    // リダイレクト先（メインページ）に遷移することを確認
    await page.waitForURL(/\/#\d+$/, { timeout: 10000 });
    // メインページのタスク一覧が表示される
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });

  test("text パラメータがフォームに反映される", async ({ page }) => {
    const title = "テストページ";
    const text = "共有テキスト";
    const url = "https://example.com/test";
    await page.goto(
      `/share/ingest?title=${encodeURIComponent(title)}&text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    );
    const textareaValue = await page.locator("#text").inputValue();
    expect(textareaValue).toContain(title);
    expect(textareaValue).toContain(text);
    expect(textareaValue).toContain(url);
  });
});
