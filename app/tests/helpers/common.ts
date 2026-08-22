/**
 * @fileoverview e2eテスト共通ヘルパー
 *
 * BASE_URL・storageStateパス・リスト準備/後片付け処理を一元管理する。
 * 各テストファイルで重複していた定義をここに集約し、
 * 不統一なパス形式（絶対パスと相対パスの混在）を解消する。
 */

import {
  expect,
  type Browser,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
import * as path from "node:path";

/** テスト対象のベースURL */
export const BASE_URL = process.env.BASE_URL ?? "https://localhost:38180";

/**
 * 認証状態ファイルのパス
 *
 * `import.meta.dirname` 基準の絶対パスで統一し、実行ディレクトリに依存しない形にする。
 * playwright.config.ts の storageState 設定はリポジトリルート基準の相対パスを使うが、
 * テストコード内では絶対パスを使うことで一貫性を保つ。
 */
export const STORAGE_STATE_PATH = path.join(
  import.meta.dirname,
  "..",
  ".auth",
  "user.json",
);

/** タスク更新mutationの応答を待つ */
export function waitForTaskUpdateResponse(page: Page): Promise<Response> {
  return page.waitForResponse((response) =>
    response.url().includes("/api/trpc/tasks.update"),
  );
}

/** 楽観追加されたタスクが実IDへ置き換わるまで待つ */
export async function waitForPersistedTask(taskRow: Locator): Promise<void> {
  await expect
    .poll(async () => Number(await taskRow.getAttribute("data-reorder-id")))
    .toBeGreaterThan(0);
}

/** タスク状態を1段階進め、成功応答と画面状態の反映後に返る */
export async function toggleTaskAndWaitForUpdate(
  page: Page,
  checkbox: Locator,
): Promise<void> {
  const taskRow = checkbox.locator("..");
  await waitForPersistedTask(taskRow);

  const wasChecked = await checkbox.isChecked();
  const wasRunning = await checkbox.evaluate(
    (element: HTMLInputElement) => element.indeterminate,
  );
  const wasArchived = await taskRow.evaluate((element) =>
    element.classList.contains("opacity-50"),
  );
  const responsePromise = waitForTaskUpdateResponse(page);
  await checkbox.dispatchEvent("click");
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`tasks.updateがHTTP ${response.status()}で失敗した`);
  }

  const taskText = taskRow.getByTestId("task-text");
  if (wasChecked) {
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toHaveJSProperty("indeterminate", false);
    await expect(taskText).not.toHaveClass(/line-through/);
  } else if (wasRunning || wasArchived) {
    await expect(checkbox).toBeChecked();
    await expect(taskText).toHaveClass(/line-through/);
  } else {
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toHaveJSProperty("indeterminate", true);
    await expect(taskText).not.toHaveClass(/line-through/);
  }
}

/** テスト用リストを作成するための共通コンテキストオプション */
function makeContextOptions() {
  return {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE_PATH,
    ignoreHTTPSErrors: true,
  };
}

async function deleteTestListFromPage(
  page: Page,
  listName: string,
): Promise<void> {
  const listRow = page.getByTestId("list-item").filter({ hasText: listName });
  if ((await listRow.count()) === 0) return;
  await listRow.getByTestId("list-menu-btn").click();
  await page.getByTestId("list-delete-btn").click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "削除", exact: true })
    .click();
  await expect(listRow).toHaveCount(0);
}

async function deleteTestListsFromPage(
  page: Page,
  listNames: readonly string[],
): Promise<void> {
  const errors: unknown[] = [];
  for (const listName of listNames) {
    try {
      await deleteTestListFromPage(page, listName);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "テスト用リストの削除に失敗した");
  }
}

/**
 * テスト用リストを作成する
 *
 * `beforeAll` から呼び出す。作成後にコンテキストをクローズする。
 */
export async function setupTestList(
  browser: Browser,
  listName: string,
): Promise<void> {
  await setupTestLists(browser, [listName]);
}

/** 1つのコンテキストで複数のテスト用リストを作成する */
export async function setupTestLists(
  browser: Browser,
  listNames: readonly string[],
): Promise<void> {
  if (listNames.length === 0) return;
  const ctx = await browser.newContext(makeContextOptions());
  const attemptedListNames: string[] = [];
  try {
    const page = await ctx.newPage();
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
    for (const listName of listNames) {
      await page.fill('aside input[placeholder="新しいリスト"]', listName);
      await page.click('aside button[type="submit"]');
      attemptedListNames.push(listName);
      await page
        .locator(`[data-testid="list-select-btn"]:has-text("${listName}")`)
        .waitFor({ timeout: 15000 });
    }
  } catch (setupError) {
    try {
      const page = ctx.pages()[0];
      if (page) await deleteTestListsFromPage(page, attemptedListNames);
    } catch (cleanupError) {
      throw new AggregateError(
        [setupError, cleanupError],
        "テスト用リストの作成と途中作成分の削除に失敗した",
        { cause: cleanupError },
      );
    }
    throw setupError;
  } finally {
    await ctx.close();
  }
}

/**
 * テスト用リストを削除する
 *
 * `afterAll` から呼び出す。削除後にコンテキストをクローズする。
 */
export async function cleanupTestList(
  browser: Browser,
  listName: string,
): Promise<void> {
  await cleanupTestLists(browser, [listName]);
}

/** 1つのコンテキストで複数のテスト用リストを削除する */
export async function cleanupTestLists(
  browser: Browser,
  listNames: readonly string[],
): Promise<void> {
  if (listNames.length === 0) return;
  const ctx = await browser.newContext(makeContextOptions());
  try {
    const page = await ctx.newPage();
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
    await deleteTestListsFromPage(page, listNames);
  } finally {
    await ctx.close();
  }
}
