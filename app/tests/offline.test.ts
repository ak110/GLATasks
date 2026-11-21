import {
  cleanupTestList,
  setupTestList,
  uniqueTestName,
} from "./helpers/common";
import { test, expect } from "@playwright/test";
/**
 * @fileoverview オフライン画面の接続回復による自動再読み込みのe2eテスト
 */

test("オフライン画面は接続回復時に自動再読み込みする", async ({ page }) => {
  const marker = `offline-marker-${uniqueTestName("e2e")}`;
  await page.route("**/healthcheck", async (route) => {
    await route.abort();
  });
  await page.goto("/offline.html");
  await page.evaluate((value) => {
    (window as typeof window & { __offlineMarker?: string }).__offlineMarker =
      value;
  }, marker);

  const blockedRequest = page.waitForRequest("**/healthcheck");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await blockedRequest;
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __offlineMarker?: string })
            .__offlineMarker,
      ),
    )
    .toBe(marker);

  await page.unroute("**/healthcheck");
  const reloaded = page.waitForEvent("load");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await reloaded;
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __offlineMarker?: string })
            .__offlineMarker,
      ),
    )
    .toBeUndefined();
  // 直接開いたオフライン画面は回復後にトップ画面へ移り、再読み込みを繰り返さない
  await expect(page).toHaveURL(/\/$/);
});

test("オフライン画面はonlineイベントなしでも回復から5秒以内に再読み込みする", async ({
  page,
}) => {
  const marker = `offline-poll-${uniqueTestName("e2e")}`;
  let blocked = 0;
  await page.route("**/healthcheck", async (route) => {
    blocked += 1;
    await route.abort();
  });
  await page.goto("/offline.html");
  await page.evaluate((value) => {
    (window as typeof window & { __offlineMarker?: string }).__offlineMarker =
      value;
  }, marker);
  // 表示直後の判定と5秒間隔の判定が続けて失敗する、通信断が続いた状態を作る
  await expect
    .poll(() => blocked, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(3);

  await page.unroute("**/healthcheck");
  const recoveredAt = Date.now();
  await page.waitForEvent("load", { timeout: 7_000 });
  expect(Date.now() - recoveredAt).toBeLessThan(6_500);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __offlineMarker?: string })
            .__offlineMarker,
      ),
    )
    .toBeUndefined();
  // 直接開いたオフライン画面は回復後にトップ画面へ移り、再読み込みを繰り返さない
  await expect(page).toHaveURL(/\/$/);
});

test("通信断で可視復帰しても、オフライン画面へ移らず表示中の画面とバナーを保つ", async ({
  page,
  context,
}) => {
  await Promise.all([
    page.goto("/"),
    page.waitForResponse((res) => res.url().includes("/api/trpc")),
  ]);
  const url = page.url();
  // 再読み込み・遷移で消える印を置き、表示中の画面が保たれたことを確かめる
  const marker = `screen-marker-${uniqueTestName("e2e")}`;
  await page.evaluate((value) => {
    (window as typeof window & { __screenMarker?: string }).__screenMarker =
      value;
  }, marker);

  await context.setOffline(true);
  // 別アプリや画面オフから戻った直後の可視復帰を発火させ、接続判定を起こす
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.locator('[data-testid="connectivity-recovery-banner"]'),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("You are offline")).toHaveCount(0);
  expect(page.url()).toBe(url);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __screenMarker?: string }).__screenMarker,
    ),
  ).toBe(marker);

  await context.setOffline(false);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.locator('[data-testid="connectivity-recovery-banner"]'),
  ).toHaveCount(0, { timeout: 15_000 });
});

test("到達不能の案内は再読み込みを促さず、回復すると可視復帰を待たずに数秒で消える", async ({
  page,
  context,
}) => {
  await Promise.all([
    page.goto("/"),
    page.waitForResponse((res) => res.url().includes("/api/trpc")),
  ]);
  const banner = page.getByTestId("connectivity-recovery-banner");

  await context.setOffline(true);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  // 到達不能が猶予（6秒）を超えて続いた時点で案内が出る
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner.getByRole("button", { name: "再読み込み" })).toHaveCount(
    0,
  );
  // HTTPSを遮断する認証画面は通信エラーと区別できないため、到達不能の案内からも認証画面を開ける
  await expect(
    banner.getByRole("button", { name: "認証画面を開く" }),
  ).toBeVisible();

  // 可視復帰やonlineイベントを起こさずに通信だけを戻し、到達不能の間の短い間隔の再判定で回復を捉えることを確かめる
  await context.setOffline(false);
  await expect(banner).toHaveCount(0, { timeout: 5_000 });
});

test("オフライン画面は応答の横取りでもonlineイベントなしで再読み込みする", async ({
  page,
}) => {
  // 認証画面がHTTP 200のHTMLで通信を差し替えている状態を再現する
  await page.route("**/healthcheck", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body>login</body></html>",
    });
  });
  await page.goto("/offline.html");
  // 表示直後の判定で横取りを検知し、直接開いたオフライン画面からトップ画面へ移る
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
  await expect(page.getByText("You are offline")).toHaveCount(0);
});

test.describe("入力中の応答の横取り", () => {
  const listName = `横取りテスト_${uniqueTestName("e2e")}`;

  test.beforeAll(async ({ browser }) => {
    await setupTestList(browser, listName);
  });

  test.afterAll(async ({ browser }) => {
    await cleanupTestList(browser, listName);
  });

  test("退避できない入力の横取りでは認証画面を別ウィンドウで開き、回復すると閉じて入力を保つ", async ({
    page,
    context,
  }) => {
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
    await page.click(`[data-testid="list-select-btn"]:has-text("${listName}")`);
    await page
      .locator('[data-testid="task-add-form"]')
      .waitFor({ timeout: 15_000 });
    const input = page.locator('textarea[placeholder*="タスクを追加"]');
    const typed = `入力中_${uniqueTestName("e2e")}`;
    await input.fill(typed);
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("Storage full", "QuotaExceededError");
      };
    });

    // 認証画面が全ての通信を差し替え、取得中の操作も失敗する状態を作る
    for (const pattern of ["**/healthcheck**", "**/api/trpc/**"]) {
      await context.route(pattern, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<html><body>login</body></html>",
        });
      });
    }
    // 可視復帰でQueryを取り直させ（TanStack Queryはwindowで購読する）、差し替えたHTML応答による失敗を観測する
    const failedQuery = page.waitForResponse(
      (res) =>
        res.url().includes("/api/trpc") &&
        (res.headers()["content-type"] ?? "").includes("text/html"),
    );
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await failedQuery;
    const banner = page.getByTestId("connectivity-recovery-banner");
    await expect(banner).toContainText(
      "再読み込みすると認証画面が開きますが、入力中の内容が消える場合があります。",
      { timeout: 15_000 },
    );
    // 横取りによる操作失敗のエラー通知は出さない
    await expect(page.getByTestId("toast-error")).toHaveCount(0);
    await context.unroute("**/api/trpc/**");

    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      banner.getByRole("button", { name: "認証画面を開く" }).click(),
    ]);
    await expect(popup).toHaveURL(/\/healthcheck$/);

    // 認証が済んで通信が戻った状態にすると、別ウィンドウが閉じてバナーが消える
    await context.unroute("**/healthcheck**");
    await expect(banner).toHaveCount(0, { timeout: 10_000 });
    await expect.poll(() => popup.isClosed(), { timeout: 10_000 }).toBe(true);
    await expect(input).toHaveValue(typed);
  });

  for (const dirty of [false, true]) {
    test(`認証画面への自動再読み込みと復元（入力${dirty ? "あり" : "なし"}）`, async ({
      page,
    }) => {
      await page.goto("/");
      await page.click(
        `[data-testid="list-select-btn"]:has-text("${listName}")`,
      );
      const input = page.getByTestId("task-add-form").locator("textarea");
      await input.focus();
      const typed = dirty ? "認証前の下書き" : "";
      if (dirty) await input.fill(typed);
      const original = page.url();
      await page.route("**/healthcheck**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<html><body>login</body></html>",
        }),
      );
      await page.route(
        (url) => url.pathname === "/",
        async (route) => {
          if (!route.request().isNavigationRequest()) return route.fallback();
          await route.fulfill({
            contentType: "text/html",
            body: "<p>認証画面</p>",
          });
        },
      );
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(page.getByText("認証画面", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await page.unrouteAll();
      await page.goto(original);
      await expect(input).toHaveValue(typed);
      await expect(
        page.getByTestId("connectivity-recovery-banner"),
      ).toHaveCount(0);
      await expect(page.getByText("入力中の内容を復元しました。")).toHaveCount(
        dirty ? 1 : 0,
      );
    });
  }

  test("横取りでも認証画面が自動で通過すれば、画面を遷移せずエラー通知も出さずに回復する", async ({
    page,
    context,
  }) => {
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
    const listButton = page.locator(
      `[data-testid="list-select-btn"]:has-text("${listName}")`,
    );
    await expect(listButton).toBeVisible();
    // 再読み込み・遷移で消える印を置き、画面を遷移しなかったことを確かめる
    const marker = `silent-pass-${uniqueTestName("e2e")}`;
    await page.evaluate((value) => {
      (window as typeof window & { __screenMarker?: string }).__screenMarker =
        value;
    }, marker);

    // 利用者の入力なしで通過する認証画面を模す。認証画面が読み込まれると通過し、以後の通信は差し替えない
    let passed = false;
    await context.route("**/__test-portal-pass", async (route) => {
      passed = true;
      await route.fulfill({ status: 204 });
    });
    for (const pattern of ["**/healthcheck**", "**/api/trpc/**"]) {
      await context.route(pattern, async (route) => {
        if (passed) {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: '<html><body>login<script>fetch("/__test-portal-pass")</script></body></html>',
        });
      });
    }
    // 可視復帰で取得し直した操作が失敗し、接続の判定が横取りを検知する（TanStack Queryはwindowで購読する）
    const failedQuery = page.waitForResponse(
      (res) =>
        res.url().includes("/api/trpc") &&
        (res.headers()["content-type"] ?? "").includes("text/html"),
    );
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await failedQuery;

    // 自動通過の後、失敗していた取得を画面の遷移なしに取り直して成功する
    const recoveredQuery = page.waitForResponse(
      (res) =>
        passed &&
        res.url().includes("/api/trpc") &&
        res.status() === 200 &&
        (res.headers()["content-type"] ?? "").includes("application/json"),
      { timeout: 20_000 },
    );
    await expect.poll(() => passed, { timeout: 15_000 }).toBe(true);
    await recoveredQuery;
    await expect(listButton).toBeVisible();
    await expect(page.getByTestId("connectivity-recovery-banner")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("toast-error")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __screenMarker?: string })
            .__screenMarker,
      ),
    ).toBe(marker);
  });
});
