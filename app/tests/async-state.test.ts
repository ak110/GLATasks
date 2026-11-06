import { test, expect } from "@playwright/test";
import {
  addTask,
  cleanupTestList,
  createListFromPage,
  isTrpcUrl,
  uniqueTestName,
} from "./helpers/common.ts";

test.describe("非同期の画面状態", () => {
  test("Aの保存応答が開き直したBの編集を変更しない", async ({
    page,
    browser,
  }) => {
    const listName = uniqueTestName("編集セッション");
    const gate = Promise.withResolvers<void>();
    const intercepted = Promise.withResolvers<void>();
    try {
      await Promise.all([
        page.goto("/"),
        page.waitForResponse((response) =>
          response.url().includes("/api/trpc"),
        ),
      ]);
      await createListFromPage(page, listName);
      const a = await addTask(page, uniqueTestName("A"));
      const bTitle = uniqueTestName("B");
      await addTask(page, bTitle);
      await page.route("**/api/trpc/**", async (route) => {
        if (isTrpcUrl(route.request().url(), "tasks.update")) {
          const response = await route.fetch();
          intercepted.resolve();
          await gate.promise;
          await route.fulfill({ response });
        } else await route.continue();
      });
      await a.getByTestId("task-edit-btn").click();
      const editor = page.getByRole("dialog", { name: "タスクの編集" });
      await editor.getByLabel("内容").fill("Aを保存");
      await editor.getByRole("button", { name: "保存して閉じる" }).click();
      await intercepted.promise;
      await editor.getByRole("button", { name: "閉じる", exact: true }).click();
      await page
        .getByRole("dialog", { name: "変更を破棄" })
        .getByRole("button", { name: "破棄して閉じる" })
        .click();
      await page
        .getByTestId("task-item")
        .filter({ hasText: bTitle })
        .getByTestId("task-edit-btn")
        .click();
      await editor.getByLabel("内容").fill("Bの未保存入力");
      const response = page.waitForResponse((result) =>
        isTrpcUrl(result.url(), "tasks.update"),
      );
      const refetched = page.waitForResponse((result) =>
        isTrpcUrl(result.url(), "tasks.listActive"),
      );
      gate.resolve();
      expect((await response).ok()).toBe(true);
      expect((await refetched).ok()).toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      await expect(editor).toBeVisible();
      await expect(editor.getByLabel("内容")).toHaveValue("Bの未保存入力");
    } finally {
      gate.resolve();
      await page.unroute("**/api/trpc/**");
      await cleanupTestList(browser, listName);
    }
  });

  test("外部削除で選択と追加フォームが解除される", async ({
    page,
    browser,
  }) => {
    const listName = uniqueTestName("選択解除");
    let needsCleanup = false;
    try {
      await Promise.all([
        page.goto("/"),
        page.waitForResponse((response) =>
          response.url().includes("/api/trpc"),
        ),
      ]);
      await createListFromPage(page, listName);
      needsCleanup = true;
      await expect(page.getByTestId("task-add-form")).toBeVisible();
      await cleanupTestList(browser, listName);
      needsCleanup = false;
      await expect(page.getByTestId("task-add-form")).toHaveCount(0);
      await expect(page).toHaveURL(/\/$/);
      expect(
        await page.evaluate(() => localStorage.getItem("selectedList")),
      ).toBeNull();
    } finally {
      if (needsCleanup) await cleanupTestList(browser, listName);
    }
  });

  test("初回タスク取得失敗を表示して再試行で回復する", async ({
    page,
    browser,
  }) => {
    const listName = uniqueTestName("取得再試行");
    let fail = true;
    try {
      await Promise.all([
        page.goto("/"),
        page.waitForResponse((response) =>
          response.url().includes("/api/trpc"),
        ),
      ]);
      await createListFromPage(page, listName);
      await page.route("**/api/trpc/**", async (route) => {
        if (fail && isTrpcUrl(route.request().url(), "tasks.listActive"))
          await route.fulfill({ status: 500 });
        else await route.continue();
      });
      await page.reload();
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: /リストを取得|タスクを取得/ })
          .first(),
      ).toBeVisible();
      const listError = page
        .getByRole("alert")
        .filter({ hasText: "リストを取得できませんでした" });
      // 初回のHTTPバッチ全体が失敗した場合、リストだけ先に再取得して選択を復元する。
      if (await listError.isVisible())
        await listError.getByRole("button", { name: "再試行" }).click();
      const alert = page
        .getByRole("alert")
        .filter({ hasText: "タスクを取得できませんでした" });
      await expect(alert).toBeVisible();
      await expect(page.getByText("タスクなし", { exact: true })).toHaveCount(
        0,
      );
      fail = false;
      await alert.getByRole("button", { name: "再試行" }).click();
      await expect(alert).toHaveCount(0);
      await expect(page.getByText("タスクなし", { exact: true })).toBeVisible();
    } finally {
      await page.unroute("**/api/trpc/**");
      await cleanupTestList(browser, listName);
    }
  });
});
