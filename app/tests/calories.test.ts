/**
 * @fileoverview カロリー計算のエンドユーザー操作テスト
 */

import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  BASE_URL,
  STORAGE_STATE_PATH,
  waitForSuccessfulMutationResponse,
} from "./helpers/common";

async function openCalories(page: Page): Promise<void> {
  await Promise.all([
    page.goto("/calories"),
    page.waitForResponse((response) => response.url().includes("/api/trpc")),
  ]);
  await expect(
    page.getByRole("heading", { name: "カロリー計算" }),
  ).toBeVisible();
}

async function addItem(page: Page, name: string, kcal = "100"): Promise<void> {
  const form = page.locator("#calorie-item-name").locator("..");
  await page.locator("#calorie-item-name").fill(name);
  await page.locator("#calorie-item-kcal").fill(kcal);
  const response = waitForSuccessfulMutationResponse(
    page,
    "calories.createItem",
  );
  await form.getByRole("button", { name: "追加", exact: true }).click();
  await response;
  await expect(
    page.getByTestId("calorie-item-row").filter({ hasText: name }),
  ).toBeVisible();
}

async function requireBoundingBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("要素の境界ボックスを取得できません");
  return box;
}

async function openRecordMenu(row: Locator): Promise<void> {
  await row.getByTestId("calorie-record-menu-btn").click();
  await expect(row.getByTestId("calorie-record-menu")).toBeVisible();
}

async function createContext(browser: Browser) {
  return browser.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE_PATH,
    ignoreHTTPSErrors: true,
  });
}

test.describe("calories", () => {
  test.beforeEach(async ({ page }) => {
    await openCalories(page);
  });

  test("ヘッダーからカロリー計算へ移動できる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /カロリー/ }).click();
    await expect(page).toHaveURL(/\/calories$/);
    await expect(
      page.getByRole("heading", { name: "カロリー計算" }),
    ).toBeVisible();
  });

  test("集計カードは直近24時間へ残りを表示し平均カードを1行へ収める", async ({
    page,
  }) => {
    await expect(page.getByTestId("calorie-summary-remaining")).toHaveText(
      /あと|超過/,
    );

    const weeklyCard = page.getByTestId("calorie-summary-7");
    const heading = await requireBoundingBox(weeklyCard.getByRole("heading"));
    const value = await requireBoundingBox(weeklyCard.locator("p"));
    expect(heading.y).toBeLessThan(value.y + value.height);
    expect(value.y).toBeLessThan(heading.y + heading.height);

    const dailyCard = await requireBoundingBox(
      page.getByTestId("calorie-summary-1"),
    );
    const weekly = await requireBoundingBox(weeklyCard);
    expect(weekly.y).toBeGreaterThanOrEqual(dailyCard.y);
    expect(weekly.y).toBeLessThan(dailyCard.y + dailyCard.height);
  });

  test("記録と品目を管理できる", async ({ page }) => {
    const itemName = `食品_${Date.now()}`;
    const renamed = `${itemName}_変更`;
    await addItem(page, itemName, "120");

    await page.locator("#calorie-record-item").fill(itemName);
    await page.locator("#calorie-record-quantity").fill("2");
    const createResponse = waitForSuccessfulMutationResponse(
      page,
      "calories.createRecord",
    );
    await page
      .locator("#calorie-record-item")
      .locator("..")
      .getByRole("button", { name: "追加", exact: true })
      .click();
    await createResponse;
    const recordRow = page
      .getByTestId("calorie-record-row")
      .filter({ hasText: itemName });
    await expect(recordRow).toContainText("240");

    await openRecordMenu(recordRow);
    await recordRow.getByRole("menuitem", { name: "編集" }).click();
    await page.locator("#calorie-record-quantity").fill("3");
    const updateRecordResponse = waitForSuccessfulMutationResponse(
      page,
      "calories.updateRecord",
    );
    await page
      .locator("#calorie-record-item")
      .locator("..")
      .getByRole("button", { name: "変更", exact: true })
      .click();
    await updateRecordResponse;
    await expect(recordRow).toContainText("360");

    const itemRow = page
      .getByTestId("calorie-item-row")
      .filter({ hasText: itemName });
    await itemRow.getByRole("button", { name: "編集" }).click();
    await page.locator("#calorie-item-name").fill(renamed);
    const updateItemResponse = waitForSuccessfulMutationResponse(
      page,
      "calories.updateItem",
    );
    await page
      .locator("#calorie-item-name")
      .locator("..")
      .getByRole("button", { name: "変更", exact: true })
      .click();
    await updateItemResponse;
    await expect(recordRow).toContainText(renamed);

    const deleteResponse = waitForSuccessfulMutationResponse(
      page,
      "calories.deleteRecord",
    );
    await openRecordMenu(recordRow);
    await recordRow.getByRole("menuitem", { name: "削除" }).click();
    await page
      .getByRole("dialog")
      .last()
      .getByRole("button", { name: "削除", exact: true })
      .click();
    await deleteResponse;
    await expect(recordRow).toHaveCount(0);
  });

  test("過去行を現在日時でコピーでき、前の30日を表示できる", async ({
    page,
  }) => {
    const itemName = `コピー_${Date.now()}`;
    await addItem(page, itemName);
    await page.locator("#calorie-record-datetime").fill("2026/08/01 01:00");
    await page.locator("#calorie-record-item").fill(itemName);
    const createResponse = waitForSuccessfulMutationResponse(
      page,
      "calories.createRecord",
    );
    await page
      .locator("#calorie-record-item")
      .locator("..")
      .getByRole("button", { name: "追加", exact: true })
      .click();
    await createResponse;

    await page.getByRole("button", { name: "前の30日" }).click();
    await expect(
      page.getByTestId("calorie-record-row").filter({ hasText: itemName }),
    ).toBeVisible();
    const copiedRow = page
      .getByTestId("calorie-record-row")
      .filter({ hasText: itemName });
    await openRecordMenu(copiedRow);
    await copiedRow.getByTestId("calorie-record-copy").click();
    await expect(page.locator("#calorie-record-item")).toHaveValue(itemName);
    await expect(page.locator("#calorie-record-datetime")).not.toHaveValue(
      "2026/08/01 01:00",
    );
  });

  test("品目と記録のCSVを入出力できる", async ({ page }) => {
    const itemName = `CSV_${Date.now()}`;
    const itemCsv = `\uFEFF品目,kcal,備考\r\n${itemName},50,移行\r\n`;
    const itemResponse = waitForSuccessfulMutationResponse(
      page,
      "calories.importItems",
    );
    await page.getByTestId("calorie-items-import").setInputFiles({
      name: "items.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(itemCsv),
    });
    await itemResponse;
    await expect(page.getByRole("status")).toContainText("品目を1件追加");

    const recordCsv = `\uFEFF日時,品目,数量\r\n2026/09/01 12:00,${itemName},2\r\n`;
    await page.getByTestId("calorie-records-import").setInputFiles({
      name: "records.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(recordCsv),
    });
    await expect(page.getByRole("dialog")).toContainText(
      "同じCSVを再度取り込むと記録が重複",
    );
    const recordResponse = waitForSuccessfulMutationResponse(
      page,
      "calories.importRecords",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "取り込む" })
      .click();
    await recordResponse;

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "記録をエクスポート" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("カロリー記録.csv");
  });

  test("記録追加と目標値変更が別ブラウザへ同期される", async ({ browser }) => {
    const contextA = await createContext(browser);
    const contextB = await createContext(browser);
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await Promise.all([openCalories(pageA), openCalories(pageB)]);
      const itemName = `同期_${Date.now()}`;
      await addItem(pageA, itemName);
      await expect(
        pageB.getByTestId("calorie-item-row").filter({ hasText: itemName }),
      ).toBeVisible({ timeout: 15_000 });

      await pageA.locator("#calorie-record-item").fill(itemName);
      const recordResponse = waitForSuccessfulMutationResponse(
        pageA,
        "calories.createRecord",
      );
      await pageA
        .locator("#calorie-record-item")
        .locator("..")
        .getByRole("button", { name: "追加", exact: true })
        .click();
      await recordResponse;
      await expect(
        pageB.getByTestId("calorie-record-row").filter({ hasText: itemName }),
      ).toBeVisible({ timeout: 15_000 });

      const goal = String(1700 + (Date.now() % 100));
      await pageA.locator("#calorie-goal").fill(goal);
      const goalResponse = waitForSuccessfulMutationResponse(
        pageA,
        "users.updatePreferences",
      );
      await pageA
        .locator("#calorie-goal")
        .locator("..")
        .getByRole("button", { name: "保存" })
        .click();
      await goalResponse;
      await expect(pageB.locator("#calorie-goal")).toHaveValue(goal, {
        timeout: 15_000,
      });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
