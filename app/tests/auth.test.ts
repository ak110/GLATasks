import { test, expect } from "@playwright/test";

const TEST_USER = "e2etest";
const TEST_PASSWORD = "e2etestpass123";

test.describe("未ログイン状態", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("認証画面は各テーマの拡大相当の高さで先頭と操作へスクロールできる", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 225 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      for (const route of [
        "/auth/login",
        "/auth/regist_user",
        "/auth/recover",
      ]) {
        await page.goto(route);
        await expect(page.getByTestId("passkey-submit")).toBeEnabled();
        if (colorScheme === "dark")
          await expect(page.locator("html")).toHaveClass(/dark/);
        const heading = page.getByRole("heading", { level: 1 });
        await heading.scrollIntoViewIfNeeded();
        await expect(heading).toBeInViewport();
        const box = await heading.boundingBox();
        expect(box?.y).toBeGreaterThanOrEqual(0);
        await page.screenshot({
          path: testInfo.outputPath(
            `${route.split("/").at(-1)}-${colorScheme}-zoom.png`,
          ),
        });
        await page.getByTestId("passkey-submit").scrollIntoViewIfNeeded();
        await expect(page.getByTestId("passkey-submit")).toBeInViewport();
      }
    }
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        for (const route of [
          "/auth/login",
          "/auth/regist_user",
          "/auth/recover",
        ]) {
          await page.goto(route);
          await expect(page.getByTestId("passkey-submit")).toBeEnabled();
          if (colorScheme === "dark")
            await expect(page.locator("html")).toHaveClass(/dark/);
          else await expect(page.locator("html")).not.toHaveClass(/dark/);
          await page.screenshot({
            path: testInfo.outputPath(
              `${route.split("/").at(-1)}-${viewport.width}-${colorScheme}.png`,
            ),
            fullPage: true,
          });
        }
      }
    }
  });

  test("/ にアクセスするとログインページへリダイレクト", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("正しい資格情報でログインすると / へリダイレクト", async ({ page }) => {
    await page.goto("/auth/login");
    await page.fill('[name="user"]', TEST_USER);
    await page.fill('[name="password"]', TEST_PASSWORD);
    await Promise.all([
      page.waitForURL("/"),
      page.click('button[type="submit"]'),
    ]);
  });

  test("未ログインで開いた画面へ、ログイン後に戻る", async ({ page }) => {
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

test.describe("ログイン済み状態", () => {
  test("ログアウトするとログインページへリダイレクト", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("account-menu-toggle").click();
    await page.click('button[type="submit"]:has-text("ログアウト")');
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
