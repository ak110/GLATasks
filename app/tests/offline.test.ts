import { uniqueTestName } from "./helpers/common";
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

  // 可視復帰やonlineイベントを起こさずに通信だけを戻し、到達不能の間の短い間隔の再判定で回復を捉えることを確かめる
  await context.setOffline(false);
  await expect(banner).toHaveCount(0, { timeout: 5_000 });
});
