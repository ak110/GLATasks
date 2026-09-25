/** @fileoverview 公開HTTP経路と未認証の登録ページを確認する。 */

import { expect, test } from "@playwright/test";

test("公開経路がヘルス情報とService Workerを返す", async ({ request }) => {
  const health = await request.get("/healthcheck");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ status: "ok" });

  const worker = await request.get("/sw.js");
  expect(worker.ok()).toBe(true);
  expect(worker.headers()["content-type"]).toContain("application/javascript");
  expect(await worker.text()).toContain("/offline.html");
});

test.describe("未認証", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("登録ページからユーザー情報を入力できる", async ({ page }) => {
    await page.goto("/auth/regist_user");
    await expect(
      page.getByRole("heading", { name: "GLATasks - ユーザー登録" }),
    ).toBeVisible();
    await expect(page.getByLabel("ユーザーID")).toBeVisible();
    await expect(page.getByLabel("パスワード", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "登録" })).toBeVisible();
  });
});
