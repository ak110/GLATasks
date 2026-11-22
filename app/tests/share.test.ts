import {
  uniqueTestName,
  makeContextOptions,
  setupTestList,
  cleanupTestList,
} from "./helpers/common";
import { test, expect } from "@playwright/test";

const LIST_NAME = `shareテスト_${uniqueTestName("e2e")}`;

test.describe("share/ingest", () => {
  test.beforeAll(async ({ browser }) => {
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
    await expect(page.locator("#list_id option")).not.toHaveCount(0, {
      timeout: 10000,
    });
    await page.locator("#list_id").selectOption({ index: 0 });
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/#\d+$/, { timeout: 10000 });
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });

  test("拡張のポップアップから追加すると同じ画面で結果を表示し、拡張からの埋め込みを保つ", async ({
    page,
  }) => {
    await page.goto("/share/ingest?title=popupテスト&in_popup=1");
    await expect(page.locator("#list_id option")).not.toHaveCount(0, {
      timeout: 10000,
    });
    await page.locator("#list_id").selectOption({ label: LIST_NAME });
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === "/share/ingest" &&
          res.request().method() === "POST",
      ),
      page.click('button[type="submit"]'),
    ]);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-security-policy"]).toBe(
      "frame-ancestors 'self' chrome-extension:",
    );
    await expect(page.getByTestId("ingest-added")).toHaveText(
      `「${LIST_NAME}」にタスクを追加しました。`,
    );
    expect(new URL(page.url()).pathname).toBe("/share/ingest");
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

  test("共有追加したタスクが別コンテキストのメインページへSSEで反映される", async ({
    browser,
  }) => {
    const listName = `共有追加SSE_${uniqueTestName("e2e")}`;
    const taskTitle = `共有追加タスク_${uniqueTestName("e2e")}`;
    await setupTestList(browser, listName);

    const ctxOptions = makeContextOptions();

    const ctxView = await browser.newContext(ctxOptions);
    const ctxShare = await browser.newContext(ctxOptions);

    try {
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
