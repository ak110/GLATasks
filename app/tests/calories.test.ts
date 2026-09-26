/**
 * @fileoverview カロリー計算のエンドユーザー操作テスト
 */

import { readFile } from "node:fs/promises";

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

/**
 * 編集ダイアログの欄のラベルと入力欄の配置を検証する
 *
 * 横幅が足りる場合はラベルが入力欄の左で同じ行に、狭い場合はラベルが入力欄の上に並ぶ。
 */
async function expectLabelPlacement(
  dialog: Locator,
  label: string,
  sideBySide: boolean,
): Promise<void> {
  const labelBox = await requireBoundingBox(
    dialog.locator("label", { hasText: new RegExp(`^${label}$`) }),
  );
  const inputBox = await requireBoundingBox(
    dialog.getByLabel(label, { exact: true }),
  );
  if (sideBySide) {
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(inputBox.x);
    const labelCenterY = labelBox.y + labelBox.height / 2;
    expect(labelCenterY).toBeGreaterThan(inputBox.y);
    expect(labelCenterY).toBeLessThan(inputBox.y + inputBox.height);
  } else {
    expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(inputBox.y);
  }
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

  test("両表の検索欄とクリアボタンを太字にしない", async ({ page }) => {
    const testIds = [
      "calorie-record-filter",
      "calorie-record-filter-clear",
      "calorie-item-filter",
      "calorie-item-filter-clear",
    ];

    for (const testId of testIds) {
      const fontWeight = await page
        .getByTestId(testId)
        .evaluate((element) => getComputedStyle(element).fontWeight);
      expect(fontWeight, testId).toBe("400");
    }
  });

  test("ヘッダーからカロリー計算へ移動できる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /カロリー/ }).click();
    await expect(page).toHaveURL(/\/calories$/);
    await expect(
      page.getByRole("heading", { name: "カロリー計算" }),
    ).toBeVisible();
  });

  test("集計カードは見出しと値を1行へ収め、残りの数値だけを強調し、左右の余白を上下均等にする", async ({
    page,
  }) => {
    const remaining = page.getByTestId("calorie-summary-remaining");
    const remainingValue = page.getByTestId("calorie-summary-remaining-value");
    await expect(remaining).toHaveText(/あと|超過/);

    // 見出しと値の縦範囲が重なれば同じ行に並んでいる
    for (const days of [1, 7, 28]) {
      const card = page.getByTestId(`calorie-summary-${days}`);
      const heading = await requireBoundingBox(card.getByRole("heading"));
      const value = await requireBoundingBox(card.locator("p").first());
      expect(heading.y, `${days}`).toBeLessThan(value.y + value.height);
      expect(value.y, `${days}`).toBeLessThan(heading.y + heading.height);
    }

    const averageSize = await page
      .getByTestId("calorie-summary-7")
      .locator("p")
      .evaluate((element) => getComputedStyle(element).fontSize);
    await expect(page.getByTestId("calorie-summary-pace")).toHaveCSS(
      "font-size",
      averageSize,
    );
    const fontSize = (element: Element) =>
      Number.parseFloat(getComputedStyle(element).fontSize);
    expect(await remainingValue.evaluate(fontSize)).toBeGreaterThan(
      await remaining.evaluate(fontSize),
    );
    await expect(remainingValue).toHaveCSS("font-weight", "700");
    await expect(remaining).toHaveCSS("font-weight", "400");

    // 左右のカード列は同じ高さに揃い、左カードの内容は上下中央に置かれる
    const dailyCard = page.getByTestId("calorie-summary-1");
    const daily = await requireBoundingBox(dailyCard);
    const averageColumn = await requireBoundingBox(
      page.getByTestId("calorie-summary-7").locator(".."),
    );
    expect(Math.abs(daily.y - averageColumn.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(daily.height - averageColumn.height)).toBeLessThanOrEqual(
      1,
    );
    const top = await requireBoundingBox(
      dailyCard.getByRole("heading").locator(".."),
    );
    const bottom = await requireBoundingBox(remaining);
    const topGap = top.y - daily.y;
    const bottomGap = daily.y + daily.height - (bottom.y + bottom.height);
    expect(Math.abs(topGap - bottomGap)).toBeLessThanOrEqual(2);
  });

  test("自動記録を追加し、ONとOFFを切り替えて削除できる", async ({ page }) => {
    const itemName = `自動_${Date.now()}`;
    await addItem(page, itemName);
    await page.locator("#calorie-auto-time").fill("08:15");
    await page.locator("#calorie-auto-item").fill(itemName);
    await page.locator("#calorie-auto-quantity").fill("2");
    const createResponse = waitForSuccessfulMutationResponse(
      page,
      "calories.createAutoRecord",
    );
    await page
      .locator("#calorie-auto-item")
      .locator("..")
      .getByRole("button", { name: "追加", exact: true })
      .click();
    await createResponse;
    const row = page
      .getByTestId("calorie-auto-record-row")
      .filter({ hasText: itemName });
    await expect(row).toContainText("08:15");
    const enabled = row.getByTestId("calorie-auto-record-enabled");
    await expect(enabled).toBeChecked();

    const toggleResponse = waitForSuccessfulMutationResponse(
      page,
      "calories.updateAutoRecord",
    );
    await enabled.click();
    await toggleResponse;
    await expect(enabled).not.toBeChecked();

    const deleteResponse = waitForSuccessfulMutationResponse(
      page,
      "calories.deleteAutoRecord",
    );
    await row.getByRole("button", { name: "削除" }).click();
    await page
      .getByRole("dialog", { name: "自動記録の削除" })
      .getByRole("button", { name: "削除", exact: true })
      .click();
    await deleteResponse;
    await expect(row).toHaveCount(0);
  });

  test("期間を指定して記録を一括追加し、一括削除できる", async ({ page }) => {
    const itemName = `一括_${Date.now()}`;
    await addItem(page, itemName);
    const records = page
      .getByTestId("calorie-record-row")
      .filter({ hasText: itemName });
    const status = page.getByTestId("calorie-bulk-status");

    // 記録表の既定表示（今日までの30日間）に入る直近3日間を指定する
    const day = (offset: number) => {
      const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const createForm = page.getByTestId("calorie-bulk-create-form");
    await createForm.getByLabel("開始日").fill(day(3));
    await createForm.getByLabel("終了日").fill(day(1));
    await createForm.getByLabel("時刻").fill("07:00");
    await createForm.getByLabel("品目").fill(itemName);
    const createResponse = waitForSuccessfulMutationResponse(
      page,
      "calories.bulkCreateRecords",
    );
    await createForm.getByRole("button", { name: "一括追加" }).click();
    await createResponse;
    await expect(status).toHaveText("3件の記録を追加しました");
    await expect(records).toHaveCount(3);

    const deleteForm = page.getByTestId("calorie-bulk-delete-form");
    await deleteForm.getByLabel("開始日").fill(day(2));
    await deleteForm.getByLabel("終了日").fill(day(1));
    await deleteForm.getByLabel("品目").fill(itemName);
    await deleteForm.getByRole("button", { name: "一括削除" }).click();
    const deleteResponse = waitForSuccessfulMutationResponse(
      page,
      "calories.bulkDeleteRecords",
    );
    await page
      .getByRole("dialog", { name: "記録の一括削除" })
      .getByRole("button", { name: "削除", exact: true })
      .click();
    await deleteResponse;
    await expect(status).toHaveText("2件の記録を削除しました");
    await expect(records).toHaveCount(1);
  });

  for (const width of [1280, 393]) {
    test(`記録と品目をダイアログで編集できる（幅${width}）`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 851 });
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
      const recordDialog = page.getByRole("dialog", { name: "記録の編集" });
      await expect(recordDialog).toBeVisible();
      // 幅393ではダイアログの内容が狭く、ラベルの下に入力欄を置く
      const sideBySide = width === 1280;
      for (const label of ["日時", "品目", "数量"]) {
        await expectLabelPlacement(recordDialog, label, sideBySide);
      }
      const dialogBox = await requireBoundingBox(recordDialog);
      const convertBox = await requireBoundingBox(
        recordDialog.getByRole("button", { name: "一時項目に変換" }),
      );
      const submitBox = await requireBoundingBox(
        recordDialog.getByRole("button", { name: "変更", exact: true }),
      );
      // 変換ボタンを左端側、変更ボタンを右端側へ置く
      expect(convertBox.x - dialogBox.x).toBeLessThan(
        dialogBox.x + dialogBox.width - (convertBox.x + convertBox.width),
      );
      expect(
        dialogBox.x + dialogBox.width - (submitBox.x + submitBox.width),
      ).toBeLessThan(submitBox.x - dialogBox.x);
      await expect(
        recordDialog.getByLabel("品目", { exact: true }),
      ).toHaveValue(itemName);
      await expect(recordDialog.getByLabel("数量")).toHaveValue("2");
      await recordDialog.getByLabel("数量").fill("9");
      await recordDialog.getByRole("button", { name: "閉じる" }).click();
      await expect(recordDialog).toHaveCount(0);
      await expect(recordRow).toContainText("240");
      await openRecordMenu(recordRow);
      await recordRow.getByRole("menuitem", { name: "編集" }).click();
      await expect(recordDialog.getByLabel("数量")).toHaveValue("2");
      await recordDialog.getByLabel("数量").fill("3");
      const updateRecordResponse = waitForSuccessfulMutationResponse(
        page,
        "calories.updateRecord",
      );
      await recordDialog
        .getByRole("button", { name: "変更", exact: true })
        .click();
      await updateRecordResponse;
      await expect(recordDialog).toHaveCount(0);
      await expect(recordRow).toContainText("360");

      const itemRow = page
        .getByTestId("calorie-item-row")
        .filter({ hasText: itemName });
      await itemRow.getByRole("button", { name: "編集" }).click();
      const itemDialog = page.getByRole("dialog", { name: "品目の編集" });
      await expect(itemDialog).toBeVisible();
      for (const label of ["品目名", "kcal", "備考"]) {
        await expectLabelPlacement(itemDialog, label, sideBySide);
      }
      await expect(itemDialog.getByLabel("品目名")).toHaveValue(itemName);
      await expect(itemDialog.getByLabel("kcal", { exact: true })).toHaveValue(
        "120",
      );
      await itemDialog.getByLabel("品目名").fill("保存しない品目");
      await page.keyboard.press("Escape");
      await expect(itemDialog).toHaveCount(0);
      await expect(itemRow).toContainText(itemName);
      await itemRow.getByRole("button", { name: "編集" }).click();
      await expect(itemDialog.getByLabel("品目名")).toHaveValue(itemName);
      await itemDialog.getByLabel("品目名").fill(renamed);
      const updateItemResponse = waitForSuccessfulMutationResponse(
        page,
        "calories.updateItem",
      );
      await itemDialog
        .getByRole("button", { name: "変更", exact: true })
        .click();
      await updateItemResponse;
      await expect(itemDialog).toHaveCount(0);
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
  }

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

    const temporaryName = `CSV一時_${Date.now()}`;
    const recordCsv = `\uFEFF日時,品目,数量,一時項目\r\n2026/09/01 12:00,${itemName},2,\r\n2026/09/01 19:00,${temporaryName},850,1\r\n`;
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
    // 取り込んだ一時項目は、エクスポートで一時項目の列が1の行になる
    const exported = await readFile(await download.path(), "utf8");
    expect(exported).toContain(`2026/09/01 19:00,${temporaryName},850,1`);
    expect(exported).toContain(`2026/09/01 12:00,${itemName},2,`);
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

/** 他のテストの記録に影響されないよう、新しく登録した利用者でカロリー計算を開く */
async function openCaloriesAsNewUser(browser: Browser) {
  // 設定ファイルの共通テスト利用者のログイン状態を引き継がないよう空の状態を渡す
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const userId = `cal${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/auth/regist_user");
  await page.fill('[name="user_id"]', userId);
  await page.fill('[name="password"]', "e2etestpass123");
  await page.fill('[name="password_confirm"]', "e2etestpass123");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), {
    timeout: 30_000,
  });
  await openCalories(page);
  return { context, page };
}

/**
 * 早朝4時で区切った日で、指定した日数前の確定日の日付を返す
 *
 * 深夜0時〜4時に実行しても、記録が意図した確定日へ入るようにする。
 */
function confirmedDay(daysAgo: number): string {
  const date = new Date(Date.now() - (4 + daysAgo * 24) * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 指定した日数前の範囲の各確定日の正午へ、品目の記録を1件ずつ追加する */
async function bulkCreate(
  page: Page,
  itemName: string,
  fromDaysAgo: number,
  toDaysAgo: number,
): Promise<void> {
  const createForm = page.getByTestId("calorie-bulk-create-form");
  await createForm.getByLabel("開始日").fill(confirmedDay(fromDaysAgo));
  await createForm.getByLabel("終了日").fill(confirmedDay(toDaysAgo));
  await createForm.getByLabel("時刻").fill("12:00");
  await createForm.getByLabel("品目").fill(itemName);
  const response = waitForSuccessfulMutationResponse(
    page,
    "calories.bulkCreateRecords",
  );
  await createForm.getByRole("button", { name: "一括追加" }).click();
  await response;
}

async function addRecordNow(page: Page, itemName: string): Promise<void> {
  await page.locator("#calorie-record-item").fill(itemName);
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
}

test.describe("calories achievement", () => {
  test("目標内の日が続くと達成状況を表示する", async ({ browser }) => {
    const { context, page } = await openCaloriesAsNewUser(browser);
    try {
      await addItem(page, "目標内", "1000");
      await bulkCreate(page, "目標内", 8, 1);

      // 8日前が最初の記録の日なので、昨日と一昨日の2日が判定され、いずれも平均1000kcal
      const block = page.getByTestId("calorie-achievement");
      await expect(block).toHaveAttribute("data-achieved", "true");
      await expect(page.getByTestId("calorie-achievement-streak")).toHaveText(
        "2日連続で目標内",
      );
      const days = page.getByTestId("calorie-achievement-day");
      await expect(days).toHaveCount(28);
      await expect(days.nth(27)).toHaveAttribute("data-status", "achieved");
      await expect(days.nth(26)).toHaveAttribute("data-status", "achieved");
      await expect(days.nth(25)).toHaveAttribute("data-status", "unrated");
    } finally {
      await context.close();
    }
  });

  test("目標超過が続くと達成表示をしない", async ({ browser }) => {
    const { context, page } = await openCaloriesAsNewUser(browser);
    try {
      await addItem(page, "超過", "2000");
      await bulkCreate(page, "超過", 8, 1);

      await expect(
        page.getByTestId("calorie-achievement-day").nth(26),
      ).toHaveAttribute("data-status", "missed");
      await expect(page.getByTestId("calorie-achievement")).toHaveAttribute(
        "data-achieved",
        "false",
      );
      await expect(
        page.getByTestId("calorie-achievement-streak"),
      ).not.toBeAttached();
      await expect(
        page.getByTestId("calorie-achievement-day").nth(27),
      ).toHaveAttribute("data-status", "missed");
    } finally {
      await context.close();
    }
  });

  test("平均が下がると先週比を表示する", async ({ browser }) => {
    const { context, page } = await openCaloriesAsNewUser(browser);
    try {
      await addItem(page, "前の週", "1500");
      await addItem(page, "直近の週", "1000");
      await bulkCreate(page, "前の週", 14, 8);
      await bulkCreate(page, "直近の週", 7, 1);

      await expect(
        page.getByTestId("calorie-achievement-weekly-change"),
      ).toHaveText("先週より −500 kcal/日");
    } finally {
      await context.close();
    }
  });

  test("残量リングが目標比を示す", async ({ browser }) => {
    const { context, page } = await openCaloriesAsNewUser(browser);
    try {
      await addItem(page, "少なめ", "800");
      await addItem(page, "多め", "1000");
      const arc = page.getByTestId("calorie-summary-ring-arc");

      // 初期目標1615kcalに対し、直後の摂取800kcalはおよそ49.5%
      await addRecordNow(page, "少なめ");
      await expect(arc).toHaveAttribute("stroke-dasharray", /^49\.\d 100$/);

      // 合計1800kcalで目標を超えると全周になる
      await addRecordNow(page, "多め");
      await expect(arc).toHaveAttribute("stroke-dasharray", "100 100");
      await expect(
        page.getByTestId("calorie-summary-ring"),
      ).toHaveAccessibleName(/^目標に対して11\d\.\d%$/);
    } finally {
      await context.close();
    }
  });
});

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
      await expect(
        rows.first().getByTestId("calorie-record-temporary-badge"),
      ).toBeVisible();
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
        await expect(
          row.getByTestId("calorie-record-temporary-badge"),
        ).toBeVisible();
        await expect(row.locator("td").nth(3)).toHaveText("450");
      }
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
      await page.keyboard.press("Escape");
      await expect(confirm).toHaveCount(0);
      await expect(recordDialog).toBeVisible();
      await expect(recordDialog.getByLabel("数量")).toHaveValue("2");
      await expect(
        row.getByTestId("calorie-record-temporary-badge"),
      ).toHaveCount(0);

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
      await expect(
        row.getByTestId("calorie-record-temporary-badge"),
      ).toBeVisible();
      await expect(row.locator("td").nth(3)).toHaveText("240");

      // 変換後は品目のkcalを変えても記録のkcalは変わらない
      const itemRow = page
        .getByTestId("calorie-item-row")
        .filter({ hasText: name });
      await itemRow.getByRole("button", { name: "編集" }).click();
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
