/**
 * @fileoverview 画面横断のスクロール境界とヘッダー位置の回帰テスト
 */

import { expect, test } from "@playwright/test";

import {
  PAGE_NAMES,
  getRootOverflow,
  openPage,
  requireBoundingBox,
  verifyScrollAreaScrollsAlone,
} from "./helpers/page-scroll";

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
});
