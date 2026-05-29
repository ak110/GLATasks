/**
 * @fileoverview share/ingest ページの e2e テスト
 */

import { test, expect } from "@playwright/test";
import {
  BASE_URL,
  STORAGE_STATE_PATH,
  setupTestList,
  cleanupTestList,
} from "./helpers/common";

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

  // ---------------------------------------------------------------------------
  // 共有追加→別コンテキストへのSSE反映
  //
  // 共有追加でタスクを追加すると更新通知が送出され、当該リストを表示中の
  // 別ブラウザコンテキストへSSE経由でタスクが反映されることを検証する。
  // ---------------------------------------------------------------------------
  test("共有追加したタスクが別コンテキストのメインページへSSEで反映される", async ({
    browser,
  }) => {
    const listName = `共有追加SSE_${Date.now()}`;
    const taskTitle = `共有追加タスク_${Date.now()}`;
    await setupTestList(browser, listName);

    const ctxOptions = {
      baseURL: BASE_URL,
      storageState: STORAGE_STATE_PATH,
      ignoreHTTPSErrors: true,
    };

    // ctxView: メインページで対象リストを表示して反映を待つ側
    // ctxShare: 共有追加ページからフォーム送信する側
    const ctxView = await browser.newContext(ctxOptions);
    const ctxShare = await browser.newContext(ctxOptions);

    try {
      // --- ctxView: メインページを開いて対象リストを選択する ---
      const pageView = await ctxView.newPage();
      await Promise.all([
        pageView.goto("/"),
        pageView.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);
      await pageView.click(
        `[data-testid="list-select-btn"]:has-text("${listName}")`,
      );
      await pageView
        .locator('[data-testid="task-add-form"]')
        .waitFor({ timeout: 15000 });

      // --- ctxShare: 共有追加ページからフォーム送信する ---
      const pageShare = await ctxShare.newPage();
      await pageShare.goto(
        `/share/ingest?title=${encodeURIComponent(taskTitle)}`,
      );
      await expect(pageShare.locator("#list_id option")).not.toHaveCount(0, {
        timeout: 10000,
      });
      await pageShare.locator("#list_id").selectOption({ label: listName });
      await pageShare.click('button[type="submit"]');
      await pageShare.waitForURL(/\/#\d+$/, { timeout: 10000 });

      // --- ctxView: 共有追加したタスクがSSE経由で現れることを検証する ---
      // 更新通知の受信と差分syncの完了を待つため、タイムアウトを15秒に設定する。
      await expect(
        pageView
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskTitle }),
      ).toBeVisible({ timeout: 15000 });
    } finally {
      await ctxShare.close();
      await ctxView.close();
      await cleanupTestList(browser, listName);
    }
  });
});
