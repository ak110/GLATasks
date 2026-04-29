/**
 * @fileoverview e2eテスト共通ヘルパー
 *
 * BASE_URL・storageStateパス・リスト準備/後片付け処理を一元管理する。
 * 各テストファイルで重複していた定義をここに集約し、
 * 不統一なパス形式（絶対パスと相対パスの混在）を解消する。
 */

import type { Browser } from "@playwright/test";
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
  const page = await ctx.newPage();
  await Promise.all([
    page.goto("/"),
    page.waitForResponse((res) => res.url().includes("/api/trpc")),
  ]);
  page.once("dialog", (dialog) => dialog.accept());
  const listRow = page
    .locator('[data-testid="list-item"]')
    .filter({ hasText: listName });
  await listRow.locator('[data-testid="list-menu-btn"]').click();
  await page.click('[data-testid="list-delete-btn"]');
  await page.waitForTimeout(1000);
  await ctx.close();
}
