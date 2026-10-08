import {
  uniqueTestName,
  requireBoundingBox,
  isTrpcUrl,
  waitForSuccessfulMutationResponse,
} from "./helpers/common";
import { test, expect, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  openCalories,
  addItem,
  expectLabelPlacement,
  openRecordMenu,
  openItemMenu,
  createContext,
  addRecordNow,
  bulkCreate,
  confirmedDay,
} from "./helpers/calorie-page";
test.describe("calories", () => {
  test.beforeEach(async ({ page }) => {
    await openCalories(page);
  });

  test("初期表示は全記録を取得せず、全期間の使用件数と古い記録を含むCSVを表示・出力する", async ({
    page,
  }) => {
    const itemName = uniqueTestName("全期間確認");
    const allRecordRequests: string[] = [];
    const observeRequest = (request: import("@playwright/test").Request) => {
      if (isTrpcUrl(request.url(), "calories.allRecords")) {
        allRecordRequests.push(request.url());
      }
    };
    page.on("request", observeRequest);
    try {
      // beforeEachの表示とは別に、監視を開始してから初期表示の全クエリを待つ。
      await Promise.all([
        ...[
          "calories.items",
          "calories.autoRecords",
          "calories.records",
          "calories.summary",
        ].map((procedure) =>
          waitForSuccessfulMutationResponse(page, procedure),
        ),
        page.reload(),
      ]);
      await expect(
        page.getByRole("heading", { name: "カロリー計算" }),
      ).toBeVisible();
      expect(allRecordRequests).toEqual([]);
      await addItem(page, itemName, "123");
      await bulkCreate(page, itemName, 45, 45);
      await bulkCreate(page, itemName, 0, 0);
      const itemRow = page
        .getByTestId("calorie-item-row")
        .filter({ hasText: itemName });
      // 初期の30日分には当日1件だけが表示されるが、使用件数には45日前も含まれる。
      await expect(
        page.getByTestId("calorie-record-row").filter({ hasText: itemName }),
      ).toHaveCount(1);
      await openItemMenu(itemRow);
      const deleteItem = itemRow.getByRole("menuitem", { name: /削除/ });
      await expect(deleteItem).toBeDisabled();
      await expect(deleteItem).toContainText("記録2件で使用中");
      await page.keyboard.press("Escape");
      expect(allRecordRequests).toEqual([]);

      const exportResponse = waitForSuccessfulMutationResponse(
        page,
        "calories.allRecords",
      );
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "記録をエクスポート" }).click();
      await exportResponse;
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe("カロリー記録.csv");
      const downloadPath = await download.path();
      expect(downloadPath).not.toBeNull();
      const csv = await readFile(downloadPath!, "utf8");
      const itemLines = csv
        .split(/\r?\n/)
        .filter((line) => line.includes(itemName));
      expect(itemLines).toHaveLength(2);
      for (const daysAgo of [45, 0]) {
        const date = confirmedDay(daysAgo).replaceAll("-", "/");
        expect(itemLines).toContain(`${date} 12:00,${itemName},1,`);
      }
      expect(allRecordRequests).toHaveLength(1);
    } finally {
      page.off("request", observeRequest);
      await page.keyboard.press("Escape");
      const itemRow = page
        .getByTestId("calorie-item-row")
        .filter({ hasText: itemName });
      if ((await itemRow.count()) > 0) {
        // 固有の品目と期間を指定し、このテストが実DBに作成した記録だけを削除する。
        const deleteForm = page.getByTestId("calorie-bulk-delete-form");
        await deleteForm.getByLabel("開始日").fill(confirmedDay(45));
        await deleteForm.getByLabel("終了日").fill(confirmedDay(0));
        await deleteForm.getByLabel("品目").fill(itemName);
        await deleteForm.getByRole("button", { name: "一括削除" }).click();
        const deleteRecords = waitForSuccessfulMutationResponse(
          page,
          "calories.bulkDeleteRecords",
        );
        await page
          .getByRole("dialog", { name: "記録の一括削除" })
          .getByRole("button", { name: "削除", exact: true })
          .click();
        await deleteRecords;
        await expect(
          page.getByRole("dialog", { name: "記録の一括削除" }),
        ).not.toBeVisible();
        await openItemMenu(itemRow);
        const deleteItem = itemRow.getByRole("menuitem", {
          name: "削除",
          exact: true,
        });
        await expect(deleteItem).toBeEnabled();
        await deleteItem.click();
        const deleteItemResponse = waitForSuccessfulMutationResponse(
          page,
          "calories.deleteItem",
        );
        await page
          .getByRole("dialog", { name: "品目の削除" })
          .getByRole("button", { name: "削除", exact: true })
          .click();
        await deleteItemResponse;
        await expect(itemRow).toHaveCount(0);
      }
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
    const itemName = `自動_${uniqueTestName("e2e")}`;
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
    await row.getByTestId("calorie-auto-record-menu-btn").click();
    await row.getByRole("menuitem", { name: "削除" }).click();
    await page
      .getByRole("dialog", { name: "自動記録の削除" })
      .getByRole("button", { name: "削除", exact: true })
      .click();
    await deleteResponse;
    await expect(row).toHaveCount(0);
  });

  test("幅320でも記録と自動記録の表の見出しと値が各列の幅に収まる", async ({
    page,
  }) => {
    const itemName = `狭幅_${uniqueTestName("e2e")}`;
    await addItem(page, itemName, "1200");
    await page.locator("#calorie-record-quantity").fill("3");
    await addRecordNow(page, itemName);
    await page.setViewportSize({ width: 320, height: 800 });

    /** 要素の内容が、幅0でない列の幅に収まっているか */
    const fitsInCell = (cell: Locator) =>
      expect
        .poll(() =>
          cell.evaluate(
            (element) =>
              element.clientWidth > 0 &&
              element.scrollWidth <= element.clientWidth,
          ),
        )
        .toBe(true);

    for (const titleId of [
      "#calorie-records-title",
      "#calorie-auto-records-title",
    ]) {
      const headers = page
        .locator("section", { has: page.locator(titleId) })
        .locator("thead tr")
        .first()
        .locator("th");
      for (const header of await headers.all()) {
        await fitsInCell(header);
      }
    }
    // 品目名は省略表示するため、日時・数量・kcalの値を確かめる
    const cells = page
      .getByTestId("calorie-record-row")
      .filter({ hasText: itemName })
      .locator("td");
    for (const index of [0, 2, 3]) {
      await fitsInCell(cells.nth(index));
    }
    await expect(cells.nth(3)).toHaveText("3600");
  });

  test("期間を指定して記録を一括追加し、一括削除できる", async ({ page }) => {
    const itemName = `一括_${uniqueTestName("e2e")}`;
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
      const itemName = `食品_${uniqueTestName("e2e")}`;
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
      await openItemMenu(itemRow);
      await itemRow.getByRole("menuitem", { name: "編集" }).click();
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
      await openItemMenu(itemRow);
      await itemRow.getByRole("menuitem", { name: "編集" }).click();
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
    const itemName = `コピー_${uniqueTestName("e2e")}`;
    await addItem(page, itemName);
    // 実行日によらず「前の30日」の内側に入り、端末と同じタイムゾーンになる日時を使う。
    const pastDateTime = await page.evaluate(() => {
      const date = new Date();
      date.setDate(date.getDate() - 45);
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} 12:00`;
    });
    await page.locator("#calorie-record-datetime").fill(pastDateTime);
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
      pastDateTime,
    );
  });

  test("品目と記録のCSVを入出力できる", async ({ page }) => {
    const itemName = `CSV_${uniqueTestName("e2e")}`;
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

    const temporaryName = `CSV一時_${uniqueTestName("e2e")}`;
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
      const itemName = `同期_${uniqueTestName("e2e")}`;
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
