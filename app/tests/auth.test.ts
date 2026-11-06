/**
 * @fileoverview 認証フロー（ログイン・ログアウト・登録）の e2e テスト
 */

import { test, expect } from "@playwright/test";

const TEST_USER = "e2etest";
const TEST_PASSWORD = "e2etestpass123";

// 未ログイン状態のテスト（storageState を空にして実行）
test.describe("未ログイン状態", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/ にアクセスするとログインページへリダイレクト", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("正しい資格情報でログインすると / へリダイレクト", async ({ page }) => {
    await page.goto("/auth/login");
    await page.fill('[name="user"]', TEST_USER);
    await page.fill('[name="password"]', TEST_PASSWORD);
    // SvelteKit form action による POST → 303 リダイレクト → "/" の遷移を待つ
    await Promise.all([
      page.waitForURL("/"),
      page.click('button[type="submit"]'),
    ]);
  });

  test("未ログインで開いた画面へ、ログイン後に戻る", async ({ page }) => {
    // Chrome拡張のポップアップはタスク追加画面を埋め込み、ログイン後もこの画面を表示し続ける必要がある
    await page.goto("/share/ingest?text=e2e&in_popup=1");
    await expect(page).toHaveURL(/\/auth\/login\?returnTo=/);
    await page.fill('[name="user"]', TEST_USER);
    await page.fill('[name="password"]', TEST_PASSWORD);
    await Promise.all([
      page.waitForURL("/share/ingest?text=e2e&in_popup=1"),
      page.click('button[type="submit"]'),
    ]);
  });

  test("登録画面を経由してログインしても、未ログインで開いた画面へ戻る", async ({
    page,
  }) => {
    // ポップアップ内でも登録画面を経由してからログインする利用があり、戻り先を失うと埋め込めない画面へ移る
    await page.goto("/share/ingest?text=e2e&in_popup=1");
    await expect(page).toHaveURL(/\/auth\/login\?returnTo=/);
    await page.getByRole("link", { name: "登録" }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/auth/regist_user" &&
        url.searchParams.has("returnTo"),
    );
    await page.getByRole("link", { name: "ログイン" }).click();
    await expect(page).toHaveURL(/\/auth\/login\?returnTo=/);
    await page.fill('[name="user"]', TEST_USER);
    await page.fill('[name="password"]', TEST_PASSWORD);
    await Promise.all([
      page.waitForURL("/share/ingest?text=e2e&in_popup=1"),
      page.click('button[type="submit"]'),
    ]);
  });

  test("誤った資格情報でログインするとエラーメッセージ表示", async ({
    page,
  }) => {
    await page.goto("/auth/login");
    await page.fill('[name="user"]', TEST_USER);
    await page.fill('[name="password"]', "wrongpassword");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=ユーザーIDまたはパスワード")).toBeVisible();
  });
});

// ログイン済み状態のテスト（storageState を使用）
test.describe("ログイン済み状態", () => {
  test("ログアウトするとログインページへリダイレクト", async ({ page }) => {
    await page.goto("/");
    await page.click('button[type="submit"]:has-text("ログアウト")');
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
