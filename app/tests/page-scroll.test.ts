import { expect, test, type Locator } from "@playwright/test";

import {
  PAGE_NAMES,
  getRootOverflow,
  openPage,
  requireBoundingBox,
  verifyScrollAreaScrollsAlone,
} from "./helpers/page-scroll";
import {
  expectStubbedPageReady,
  installAiStubs,
} from "./helpers/translate-page";

test.describe("page scroll", () => {
  test("4画面で文書ルートが縦スクロールしない", async ({ page }) => {
    for (const name of PAGE_NAMES) {
      await openPage(page, name);
      expect(await getRootOverflow(page), name).toBeLessThanOrEqual(0);
    }
  });

  test("ヘッダー右端の操作の横位置が4画面で一致する", async ({ page }) => {
    let expectedX: number | undefined;
    for (const name of PAGE_NAMES) {
      await openPage(page, name);
      const box = await requireBoundingBox(page.getByTestId("theme-toggle"));
      if (expectedX === undefined) expectedX = box.x;
      else expect(box.x, name).toBeCloseTo(expectedX, 1);
    }
  });

  test("ヘッダー下の領域だけがスクロールする", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await openPage(page, "calories");
    await verifyScrollAreaScrollsAlone(page);
  });

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 320, height: 800 },
  ]) {
    test(`同時バナーがヘッダーとタイマー追加を覆わない（幅${viewport.width}）`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      await installAiStubs(page);
      let unhealthy = false;
      const newVersion = "e2e-banner-layout-new-version";
      let reportNewVersion = false;
      await page.route("**/__data.json*", async (route) => {
        if (!reportNewVersion) return route.continue();
        const response = await route.fetch();
        await route.fulfill({
          response,
          headers: { ...response.headers(), "x-sveltekit-version": newVersion },
        });
      });
      await page.route("**/healthcheck", (route) =>
        route.fulfill({
          status: unhealthy ? 503 : 200,
          json: { status: unhealthy ? "offline" : "ok" },
        }),
      );

      async function expectUncovered(locator: Locator) {
        await expect(locator).toBeVisible();
        await expect
          .poll(() =>
            locator.evaluate((element) => {
              const box = element.getBoundingClientRect();
              const hit = document.elementFromPoint(
                box.x + box.width / 2,
                box.y + box.height / 2,
              );
              return hit !== null && element.contains(hit);
            }),
          )
          .toBe(true);
      }

      for (const name of PAGE_NAMES) {
        unhealthy = false;
        reportNewVersion = false;
        const otherName = name === "tasks" ? "timers" : "tasks";
        await openPage(page, otherName);
        await page.getByTestId(`header-nav-${name}`).click();
        await expect
          .poll(() => new URL(page.url()).pathname)
          .toBe(name === "tasks" ? "/" : `/${name}`);
        if (name === "translate") await expectStubbedPageReady(page);
        const timerDialog = page.getByRole("dialog", {
          name: /^(?:一時)?タイマー追加$/,
        });
        if (name === "timers") {
          await page.getByTestId("timer-add-btn").click();
          await expect(timerDialog).toBeVisible();
        } else {
          const input =
            name === "tasks"
              ? page.getByTestId("search-input")
              : name === "translate"
                ? page.getByTestId("translate-source-input")
                : page.locator("#calorie-record-datetime");
          await expect(input).toBeEnabled();
          await input.focus();
          await expect(input).toBeFocused();
        }
        reportNewVersion = true;
        await Promise.all([
          page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname.endsWith("/__data.json") &&
              response.headers()["x-sveltekit-version"] === newVersion,
          ),
          page
            .getByTestId(`header-nav-${otherName}`)
            .dispatchEvent("mouseover"),
        ]);
        unhealthy = true;
        await Promise.all([
          page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/healthcheck" &&
              response.status() === 503,
          ),
          page.evaluate(() => window.dispatchEvent(new Event("online"))),
        ]);
        const update = page.getByTestId("update-banner");
        const connectivity = page.getByTestId("connectivity-recovery-banner");
        await expect(update).toBeVisible();
        await expect(connectivity).toBeVisible({ timeout: 15_000 });
        if (name === "timers") {
          await page.keyboard.press("Escape");
          await expect(timerDialog).not.toBeVisible();
          await expect(page.getByTestId("timer-add-btn")).toBeFocused();
        }

        const updateBox = await requireBoundingBox(update);
        const connectivityBox = await requireBoundingBox(connectivity);
        const headerBox = await requireBoundingBox(page.locator("header"));
        const contentArea =
          name === "tasks"
            ? page.getByRole("main", { includeHidden: true }).locator("..")
            : page.getByTestId("page-scroll-area");
        const scrollBox = await requireBoundingBox(contentArea);
        expect(connectivityBox.y, name).toBeGreaterThanOrEqual(
          updateBox.y + updateBox.height,
        );
        expect(headerBox.y, name).toBeGreaterThanOrEqual(
          connectivityBox.y + connectivityBox.height,
        );
        expect(scrollBox.y, name).toBeGreaterThanOrEqual(
          headerBox.y + headerBox.height,
        );
        expect(await getRootOverflow(page), name).toBeLessThanOrEqual(0);
        await expectUncovered(page.getByTestId(`header-nav-${name}`));

        if (name === "timers") {
          await expectUncovered(
            page.getByRole("heading", { name: "タイマー", exact: true }),
          );
          await expectUncovered(page.getByTestId("theme-toggle"));
          const primaryAdd = page.getByTestId("timer-add-btn");
          await expect(primaryAdd).toBeFocused();
          await page.keyboard.press("Shift+Tab");
          await expect(page.locator("header :focus")).toHaveCount(1);
          await expectUncovered(page.locator("header :focus"));
          await page.keyboard.press("Tab");
          await expect(primaryAdd).toBeFocused();
          await expectUncovered(primaryAdd);
          const addIds =
            viewport.width === 320
              ? ["timer-add-btn"]
              : ["timer-add-btn", "timer-add-ephemeral-btn"];
          for (const id of addIds) {
            const add = page.getByTestId(id);
            await expectUncovered(add);
            await add.click();
            await expect(timerDialog).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(timerDialog).not.toBeVisible();
            await expect(add).toBeFocused();
          }
        }
      }
    });
  }
});
