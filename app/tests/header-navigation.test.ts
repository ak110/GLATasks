/**
 * @fileoverview 共通ヘッダーのナビゲーション契約テスト
 */

import { expect, test } from "@playwright/test";

import { openPage, PAGE_NAMES } from "./helpers/page-scroll";

const navigationElements = [
  { testId: "header-nav-tasks", text: "📋タスク" },
  { testId: "header-nav-separator", text: "|" },
  { testId: "header-nav-timers", text: "⏱タイマー" },
  { testId: "header-nav-separator", text: "|" },
  { testId: "header-nav-translate", text: "🌐翻訳" },
  { testId: "header-nav-separator", text: "|" },
  { testId: "header-nav-calories", text: "🍴カロリー" },
] as const;

test.describe("ヘッダーのナビゲーション", () => {
  test("ヘッダーにGLATasksの文字を表示しない", async ({ page }) => {
    for (const name of PAGE_NAMES) {
      await openPage(page, name);
      await expect(page.locator("header")).not.toContainText("GLATasks");
    }
  });

  test("ナビゲーションが4項目とセパレーターを交互に並べる", async ({
    page,
  }) => {
    for (const name of PAGE_NAMES) {
      await openPage(page, name);
      const elements = await page
        .locator('header [data-testid^="header-nav"]')
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            testId: node.getAttribute("data-testid"),
            text: node.textContent?.replace(/\s/g, ""),
          })),
        );
      expect(elements, name).toEqual(navigationElements);
    }
  });

  test("現在の画面の項目だけをリンクにしない", async ({ page }) => {
    for (const currentPage of PAGE_NAMES) {
      await openPage(page, currentPage);
      for (const item of PAGE_NAMES) {
        const expectedTag = item === currentPage ? "SPAN" : "A";
        await expect(page.getByTestId(`header-nav-${item}`)).toHaveJSProperty(
          "tagName",
          expectedTag,
        );
      }
    }
  });

  test("タスク項目からタスク画面へ遷移できる", async ({ page }) => {
    await openPage(page, "timers");
    await page.getByTestId("header-nav-tasks").click();
    await expect(page).toHaveURL(/\/$/);
  });
});
