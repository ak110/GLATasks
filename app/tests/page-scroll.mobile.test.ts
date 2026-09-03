/**
 * @fileoverview 狭い画面でのスクロール境界と主要操作の到達性の回帰テスト
 */

import { expect, test } from "@playwright/test";

import { waitForSuccessfulMutationResponse } from "./helpers/common";
import {
  getRootOverflow,
  openPage,
  verifyScrollAreaScrollsAlone,
} from "./helpers/page-scroll";

test("狭い画面でもヘッダー下の領域だけがスクロールし主要操作へ到達できる", async ({
  page,
}) => {
  // カロリー計算: 集計カードが1列へ折り返し、記録・品目・CSV操作が縦に並ぶ
  await openPage(page, "calories");
  await verifyScrollAreaScrollsAlone(page);
  const goalForm = page.locator("#calorie-goal").locator("..");
  const saveGoalButton = goalForm.getByRole("button", { name: "保存" });
  await expect(saveGoalButton).toBeVisible();
  const goalResponse = waitForSuccessfulMutationResponse(
    page,
    "users.updatePreferences",
  );
  await saveGoalButton.click();
  await goalResponse;

  // 翻訳: 原文と訳文の入力欄が同時に下限高へ達する
  await openPage(page, "translate");
  await verifyScrollAreaScrollsAlone(page);
  const sourceInput = page.getByTestId("translate-source-input");
  await expect(sourceInput).toBeVisible();
  await sourceInput.fill("スクロール境界の確認");
  await expect(sourceInput).toHaveValue("スクロール境界の確認");

  // タイマー: 追加操作がスクロール領域の先頭に並ぶ
  await openPage(page, "timers");
  const addTimerButton = page.getByTestId("timer-add-btn");
  await expect(addTimerButton).toBeVisible();
  await addTimerButton.click();
  const timerNameInput = page.getByTestId("timer-name-input");
  await expect(timerNameInput).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(timerNameInput).toBeHidden();
  expect(await getRootOverflow(page)).toBeLessThanOrEqual(0);
});
