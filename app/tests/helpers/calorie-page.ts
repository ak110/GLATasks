import {
  uniqueTestName,
  makeContextOptions,
  requireBoundingBox,
  waitForSuccessfulMutationResponse,
} from "./common";
import {
  expect,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
/**
 * @fileoverview カロリー計算のエンドユーザー操作テスト
 */

export async function openCalories(page: Page): Promise<void> {
  await Promise.all([
    page.goto("/calories"),
    page.waitForResponse((response) => response.url().includes("/api/trpc")),
  ]);
  await expect(
    page.getByRole("heading", { name: "カロリー計算" }),
  ).toBeVisible();
}

export async function addItem(
  page: Page,
  name: string,
  kcal = "100",
): Promise<void> {
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

/**
 * 編集ダイアログの欄のラベルと入力欄の配置を検証する
 *
 * 横幅が足りる場合はラベルが入力欄の左で同じ行に、狭い場合はラベルが入力欄の上に並ぶ。
 */
export async function expectLabelPlacement(
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

export async function openRecordMenu(row: Locator): Promise<void> {
  await row.getByTestId("calorie-record-menu-btn").click();
  await expect(row.getByTestId("calorie-record-menu")).toBeVisible();
}

export async function openItemMenu(row: Locator): Promise<void> {
  await row.getByTestId("calorie-item-menu-btn").click();
  await expect(row.getByTestId("calorie-item-menu")).toBeVisible();
}

export async function createContext(browser: Browser) {
  return browser.newContext(makeContextOptions());
}

/** 他のテストの記録に影響されないよう、新しく登録した利用者でカロリー計算を開く */
export async function openCaloriesAsNewUser(browser: Browser) {
  // 設定ファイルの共通テスト利用者のログイン状態を引き継がないよう空の状態を渡す
  const context = await browser.newContext(
    makeContextOptions({ storageState: { cookies: [], origins: [] } }),
  );
  const page = await context.newPage();
  const userId = `cal${uniqueTestName("e2e").replaceAll("_", "")}${Math.random().toString(36).slice(2, 6)}`;
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
export function confirmedDay(daysAgo: number): string {
  const date = new Date(Date.now() - (4 + daysAgo * 24) * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 指定した日数前の範囲の各確定日の正午へ、品目の記録を1件ずつ追加する */
export async function bulkCreate(
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

export async function addRecordNow(
  page: Page,
  itemName: string,
): Promise<void> {
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
  // フォームは一覧の再取得後に空へ戻るため、続けて入力する前に空になるのを待つ
  await expect(page.locator("#calorie-record-item")).toHaveValue("");
}
