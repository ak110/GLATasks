import { test, expect } from "@playwright/test";
import {
  addItem,
  openRecordMenu,
  openCaloriesAsNewUser,
  addRecordNow,
} from "./helpers/calorie-page";
test.describe("calories filter", () => {
  test("追加欄への入力で記録と品目を検索する", async ({ browser }) => {
    const { context, page } = await openCaloriesAsNewUser(browser);
    try {
      await addItem(page, "Apple Pie");
      await page.locator("#calorie-item-note").fill("朝食");
      await addItem(page, "バナナ");
      await addRecordNow(page, "Apple Pie");
      await addRecordNow(page, "バナナ");

      const recordInput = page.locator("#calorie-record-item");
      const itemInput = page.locator("#calorie-item-name");
      const records = page.getByTestId("calorie-record-row");
      const items = page.getByTestId("calorie-item-row");
      const statuses = page.getByTestId("calorie-filter-status");
      await expect(page.getByRole("searchbox")).toHaveCount(0);
      await expect(statuses).toHaveCount(0);
      await expect(records).toHaveCount(2);
      await expect(items).toHaveCount(2);

      await recordInput.fill("apple");
      await expect(records).toHaveCount(1);
      await expect(records).toContainText("Apple Pie");
      await expect(items).toHaveCount(1);
      await expect(items).toContainText("Apple Pie");

      await itemInput.fill("pie");
      await expect(records).toHaveCount(1);
      await expect(items).toHaveCount(1);
      await itemInput.fill("バナナ");
      await expect(statuses).toHaveCount(2);
      for (const status of await statuses.all()) {
        await expect(status).toHaveText(/「apple」「バナナ」で検索中/);
      }
      await expect(records).toHaveCount(0);
      await expect(page.getByText("該当する記録はありません")).toBeVisible();
      await expect(items).toHaveCount(0);
      await expect(page.getByText("該当する品目はありません")).toBeVisible();

      await recordInput.fill("");
      await itemInput.fill("朝食");
      await expect(items).toHaveCount(1);
      await expect(items).toContainText("バナナ");
      await expect(records).toHaveCount(0);

      await recordInput.fill("apple");
      await statuses
        .first()
        .getByRole("button", { name: "検索を解除" })
        .click();
      await expect(recordInput).toHaveValue("");
      await expect(itemInput).toHaveValue("");
      await expect(statuses).toHaveCount(0);
      await expect(records).toHaveCount(2);
      await expect(items).toHaveCount(2);

      await recordInput.fill("apple");
      const appleRow = records.filter({ hasText: "Apple Pie" });
      await openRecordMenu(appleRow);
      await appleRow.getByRole("menuitem", { name: "編集" }).click();
      const recordDialog = page.getByRole("dialog", { name: "記録の編集" });
      await expect(
        recordDialog.getByLabel("品目", { exact: true }),
      ).toHaveValue("Apple Pie");
      await expect(records).toHaveCount(2);
      await recordDialog.getByRole("button", { name: "閉じる" }).click();
      await expect(recordDialog).toHaveCount(0);
      await expect(recordInput).toHaveValue("");
      await expect(records).toHaveCount(2);
    } finally {
      await context.close();
    }
  });
});
