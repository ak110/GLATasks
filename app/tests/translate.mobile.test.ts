import { expect, test } from "@playwright/test";
import { getState, openStubbedPage } from "./helpers/translate-page";

test.describe("translate mobile", () => {
  test("狭い画面で入力欄を1列に並べて主要操作へ到達できる", async ({
    page,
  }) => {
    await openStubbedPage(page);
    const source = page.getByTestId("translate-source-input");
    const target = page.getByTestId("translate-target-output");
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    if (!sourceBox || !targetBox) return;
    expect(targetBox.y).toBeGreaterThan(sourceBox.y + sourceBox.height - 1);
    expect(sourceBox.height).toBeGreaterThanOrEqual(256);
    expect(targetBox.height).toBeGreaterThanOrEqual(256);

    await source.fill("こんにちは");
    await expect(target).toHaveValue("[ja>en] こんにちは", { timeout: 5000 });
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByTestId("translate-copy-btn").click();
    await expect(page.getByTestId("translate-status")).toContainText(
      "訳文をコピーしました",
    );
  });

  test("狭い画面でも準備と状態表示を操作できる", async ({ page }) => {
    await openStubbedPage(page, {
      detectorAvailability: "downloadable",
      translatorAvailability: "downloadable",
    });
    await page.getByTestId("translate-source-input").fill("こんにちは");
    await expect(page.getByTestId("translate-status")).toContainText(
      "準備が必要です",
    );
    await page.getByTestId("translate-prepare-btn").click();
    await expect(page.getByTestId("translate-target-output")).toHaveValue(
      "[ja>en] こんにちは",
      { timeout: 5000 },
    );
    expect((await getState(page)).translatorCreateCount).toBe(1);
  });
});
