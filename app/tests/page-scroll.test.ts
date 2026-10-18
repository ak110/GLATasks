/**
 * @fileoverview 画面横断のスクロール境界とヘッダー位置の回帰テスト
 */

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
      await page.setViewportSize(viewport);
      // 翻訳画面へ画面遷移で入るため、ブラウザー内蔵AIのスタブを最初の読み込みから注入しておく。
      await installAiStubs(page);
      let unhealthy = false;
      // 更新案内は、画面遷移のデータ応答の`x-sveltekit-version`が読み込み時の版と異なると表示される。
      // `version.json`の定期確認は開発サーバーで行われないため、両方の環境で働くデータ応答を使う。
      const newVersion = "e2e-banner-layout-new-version";
      await page.route("**/__data.json*", async (route) => {
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

      // visibleだけでは、前面のバナーに覆われた操作も合格してしまう。
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
        // 別の画面を読み込み直してから、ヘッダーの画面遷移で対象の画面へ入り、更新案内を表示させる。
        await openPage(page, name === "tasks" ? "timers" : "tasks");
        await Promise.all([
          page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname.endsWith("/__data.json") &&
              response.headers()["x-sveltekit-version"] === newVersion,
          ),
          page.getByTestId(`header-nav-${name}`).click(),
        ]);
        if (name === "translate") await expectStubbedPageReady(page);
        const timerDialog = page.getByRole("dialog", {
          name: /^(?:一時)?タイマー追加$/,
        });
        if (name === "timers") {
          // データを書かず、実ダイアログの表示中に接続不全を検知させる。
          await page.getByTestId("timer-add-btn").click();
          await expect(timerDialog).toBeVisible();
        } else {
          // 入力要素へのフォーカスは公開UIから行い、private状態は注入しない。
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
        await expect(connectivity).toBeVisible();
        if (name === "timers") {
          await page.keyboard.press("Escape");
          await expect(timerDialog).not.toBeVisible();
          await expect(page.getByTestId("timer-add-btn")).toBeFocused();
        }

        const updateBox = await requireBoundingBox(update);
        const connectivityBox = await requireBoundingBox(connectivity);
        const headerBox = await requireBoundingBox(page.locator("header"));
        // タスク画面は左右分割で、PageScrollAreaではなく共通の親領域を使う。
        // 狭幅ではmain自体がhiddenになるため、DOM上のmainから親を取得する。
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
        // 狭幅tasksの既存横見切れとは分け、画面内のナビゲーションを観測する。
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
          // 一時追加の狭幅での横見切れは既存不足のため、この縦遮蔽の受入と分ける。
          const addIds =
            viewport.width === 320
              ? ["timer-add-btn"]
              : ["timer-add-btn", "timer-add-ephemeral-btn"];
          for (const id of addIds) {
            const add = page.getByTestId(id);
            await expectUncovered(add);
            // forceなしのクリックで、バナー越しではなく実操作が届くことを確認する。
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
