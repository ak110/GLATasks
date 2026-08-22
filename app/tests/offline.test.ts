/**
 * @fileoverview オフライン画面の接続回復による自動再読み込みのe2eテスト
 */

import { test, expect } from "@playwright/test";

test("オフライン画面は接続回復時に自動再読み込みする", async ({ page }) => {
  const marker = `offline-marker-${Date.now()}`;
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
});
