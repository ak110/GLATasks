import { test, expect } from "@playwright/test";
import { waitForSuccessfulMutationResponse } from "./helpers/common";
import {
  addItem,
  openRecordMenu,
  openItemMenu,
  openCaloriesAsNewUser,
  addRecordNow,
} from "./helpers/calorie-page";
test.describe("calories temporary items", () => {
  test("品目表に無い名前は一時項目として記録し、同名の品目を後から追加しても掛け算しない", async ({
    browser,
  }) => {
    const { context, page } = await openCaloriesAsNewUser(browser);
    try {
      const name = "外食";
      const quantity = page.locator("#calorie-record-quantity");
      await page.locator("#calorie-record-item").fill(name);
      await expect(
        page.getByTestId("calorie-record-temporary-notice"),
      ).toBeVisible();
      await expect(quantity).toHaveAccessibleName("kcal");
      await quantity.fill("450");
      await addRecordNow(page, name);

      const rows = page
        .getByTestId("calorie-record-row")
        .filter({ hasText: name });
      await expect(rows).toHaveCount(1);
      await expect(rows.first().locator("td").nth(1)).toHaveText(name);
      await expect(rows.first().locator("td").nth(2)).toHaveText("");
      await expect(rows.first().locator("td").nth(2)).toHaveAccessibleName(
        "一時項目のため数量欄は空欄",
      );
      await expect(rows.first().locator("td").nth(3)).toHaveText("450");
      await expect(page.getByTestId("calorie-summary-pace")).toContainText(
        "450 kcal",
      );

      await addItem(page, name, "100");
      await openRecordMenu(rows.first());
      await rows.first().getByTestId("calorie-record-copy").click();
      await expect(
        page.getByTestId("calorie-record-temporary-notice"),
      ).toBeVisible();
      await expect(quantity).toHaveValue("450");
      const response = waitForSuccessfulMutationResponse(
        page,
        "calories.createRecord",
      );
      await page
        .locator("#calorie-record-item")
        .locator("..")
        .getByRole("button", { name: "追加", exact: true })
        .click();
      await response;

      await expect(rows).toHaveCount(2);
      for (const row of await rows.all()) {
        await expect(row.locator("td").nth(1)).toHaveText(name);
        await expect(row.locator("td").nth(2)).toHaveText("");
        await expect(row.locator("td").nth(3)).toHaveText("450");
      }
    } finally {
      await context.close();
    }
  });

  test("使われていない品目だけを削除でき、使用中の品目は理由を示して削除させない", async ({
    browser,
  }) => {
    // 削除する品目を表の最後の行にし、メニューが表の下端より外へ出る場合も確かめる
    const { context, page } = await openCaloriesAsNewUser(browser);
    try {
      const unusedName = "品目Z_未使用";
      const usedName = "品目A_使用中";
      await addItem(page, unusedName);
      await addItem(page, usedName);
      await addRecordNow(page, usedName);

      const usedRow = page
        .getByTestId("calorie-item-row")
        .filter({ hasText: usedName });
      await openItemMenu(usedRow);
      const usedDelete = usedRow.getByRole("menuitem", { name: /削除/ });
      await expect(usedDelete).toBeDisabled();
      await expect(usedDelete).toContainText("記録1件で使用中");
      await page.keyboard.press("Escape");
      await expect(usedRow.getByTestId("calorie-item-menu")).toHaveCount(0);

      const unusedRow = page
        .getByTestId("calorie-item-row")
        .filter({ hasText: unusedName });
      await openItemMenu(unusedRow);
      const unusedDelete = unusedRow.getByRole("menuitem", { name: "削除" });
      // メニューが周囲の要素に切り取られず、項目の中心を押すとその項目自身に届く
      await expect
        .poll(() =>
          unusedDelete.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return (
              document.elementFromPoint(
                box.x + box.width / 2,
                box.y + box.height / 2,
              ) === element
            );
          }),
        )
        .toBe(true);
      await unusedDelete.click();
      const confirm = page.getByRole("dialog", { name: "品目の削除" });
      await expect(confirm).toContainText(`「${unusedName}」を削除しますか？`);
      const response = waitForSuccessfulMutationResponse(
        page,
        "calories.deleteItem",
      );
      await confirm.getByRole("button", { name: "削除", exact: true }).click();
      await response;
      await expect(unusedRow).toHaveCount(0);
      await expect(usedRow).toHaveCount(1);
    } finally {
      await context.close();
    }
  });

  test("記録の編集ダイアログから確認のうえ一時項目へ変換する", async ({
    browser,
  }) => {
    const { context, page } = await openCaloriesAsNewUser(browser);
    try {
      const name = "変換元";
      await addItem(page, name, "120");
      await page.locator("#calorie-record-quantity").fill("2");
      await addRecordNow(page, name);
      const row = page
        .getByTestId("calorie-record-row")
        .filter({ hasText: name });
      await expect(row).toContainText("240");

      await openRecordMenu(row);
      await row.getByRole("menuitem", { name: "編集" }).click();
      const recordDialog = page.getByRole("dialog", { name: "記録の編集" });
      const convertButton = recordDialog.getByRole("button", {
        name: "一時項目に変換",
      });
      const confirm = page.getByRole("dialog", { name: "一時項目への変換" });

      // 変換ボタンは品目名が品目表と一致する間だけ表示する
      const itemInput = recordDialog.getByLabel("品目", { exact: true });
      await itemInput.fill("");
      await expect(convertButton).toHaveCount(0);
      await itemInput.fill(name);
      await expect(convertButton).toBeVisible();

      // キャンセルとEscapeでは確認だけを閉じ、編集ダイアログと記録を保つ
      await convertButton.click();
      await expect(confirm).toContainText("240 kcal（120 kcal × 2）");
      await confirm.getByRole("button", { name: "キャンセル" }).click();
      await expect(confirm).toHaveCount(0);
      await expect(recordDialog).toBeVisible();
      await convertButton.click();
      await expect(confirm).toBeVisible();
      await expect(
        confirm.getByRole("button", { name: "キャンセル", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(confirm).toHaveCount(0);
      await expect(recordDialog).toBeVisible();
      await expect(recordDialog.getByLabel("数量")).toHaveValue("2");
      await expect(row.locator("td").nth(1)).toHaveText(name);
      await expect(row.locator("td").nth(2)).toHaveText("2");

      // キーボードで確認ボタンへ移ると、どちらにフォーカスがあるかを枠で示す
      await convertButton.click();
      const confirmButton = confirm.getByRole("button", {
        name: "変換",
        exact: true,
      });
      await page.keyboard.press("Tab");
      await expect(confirmButton).toBeFocused();
      await expect(confirmButton).toHaveCSS("outline-style", "solid");
      const response = waitForSuccessfulMutationResponse(
        page,
        "calories.updateRecord",
      );
      await confirmButton.click();
      await response;
      await expect(recordDialog).toHaveCount(0);
      await expect(row.locator("td").nth(1)).toHaveText(name);
      await expect(row.locator("td").nth(2)).toHaveText("");
      await expect(row.locator("td").nth(3)).toHaveText("240");

      // 変換後は品目のkcalを変えても記録のkcalは変わらない
      const itemRow = page
        .getByTestId("calorie-item-row")
        .filter({ hasText: name });
      await openItemMenu(itemRow);
      await itemRow.getByRole("menuitem", { name: "編集" }).click();
      const itemDialog = page.getByRole("dialog", { name: "品目の編集" });
      await itemDialog.getByLabel("kcal", { exact: true }).fill("300");
      const itemResponse = waitForSuccessfulMutationResponse(
        page,
        "calories.updateItem",
      );
      await itemDialog
        .getByRole("button", { name: "変更", exact: true })
        .click();
      await itemResponse;
      await expect(itemRow).toContainText("300");
      await expect(row.locator("td").nth(3)).toHaveText("240");
    } finally {
      await context.close();
    }
  });
});
