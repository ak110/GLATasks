/**
 * @fileoverview 狭い画面での共通ヘッダーナビゲーション契約テスト
 */

import { expect, test } from "@playwright/test";

import { openPage, PAGE_NAMES } from "./helpers/page-scroll";

test.describe("狭い画面のヘッダーナビゲーション", () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page, "tasks");
  });

  test("狭い画面でもセパレーターを表示する", async ({ page }) => {
    const separators = page.getByTestId("header-nav-separator");
    await expect(separators).toHaveCount(3);
    for (const separator of await separators.all()) {
      await expect(separator).toBeVisible();
    }
  });

  test("狭い画面ではナビゲーションのラベルを隠す", async ({ page }) => {
    const icons = ["📋", "⏱", "🌐", "🍴"];
    for (const [index, item] of PAGE_NAMES.entries()) {
      await expect(page.getByTestId(`header-nav-${item}`)).toHaveText(
        icons[index],
      );
    }
  });
});
