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
export function waitForTaskUpdateResponse(page: Page) {
  return page.waitForResponse((response) =>
    response.url().includes("/api/trpc/tasks.update"),
  );
}

/** タスク状態を1段階進め、更新完了後に返る */
export async function toggleTaskAndWaitForUpdate(
  page: Page,
  checkbox: Locator,
): Promise<void> {
  const response = waitForTaskUpdateResponse(page);
  await checkbox.dispatchEvent("click");
  await response;
}

/** テスト用リストを作成するための共通コンテキストオプション */
function makeContextOptions() {
  return {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE_PATH,
    ignoreHTTPSErrors: true,
  };
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
  const ctx = await browser.newContext(makeContextOptions());
  const page = await ctx.newPage();
  await Promise.all([
    page.goto("/"),
    page.waitForResponse((res) => res.url().includes("/api/trpc")),
  ]);
  await page.fill('aside input[placeholder="新しいリスト"]', listName);
  await page.click('aside button[type="submit"]');
  await page
    .locator(`[data-testid="list-select-btn"]:has-text("${listName}")`)
    .waitFor({ timeout: 15000 });
  await ctx.close();
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
  const ctx = await browser.newContext(makeContextOptions());
  try {
    const page = await ctx.newPage();
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
    const listRow = page.getByTestId("list-item").filter({ hasText: listName });
    await listRow.getByTestId("list-menu-btn").click();
    await page.getByTestId("list-delete-btn").click();
    await page
      .getByRole("dialog")
      .last()
      .getByRole("button", { name: "削除", exact: true })
      .click();
    await expect(listRow).toHaveCount(0);
  } finally {
    await ctx.close();
  }
}
