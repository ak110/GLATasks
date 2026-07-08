/**
 * @fileoverview 定期TODOスケジュールのCRUD操作とダイアログ表示に関する e2e テスト
 *
 * 仮想時計やサーバー時刻操作には依存しない。発火タイミングの検証は行わない
 * （発火ロジックはサーバー側vitestの `scheduler.test.ts` が担当する）。
 */

import { test, expect, type Page } from "@playwright/test";
import { setupTestList, cleanupTestList } from "./helpers/common";

const LIST_NAME = `定期TODOテスト_${Date.now()}`;

test.describe("schedule", () => {
  test.beforeAll(async ({ browser }) => {
    await setupTestList(browser, LIST_NAME);
  });

  test.afterAll(async ({ browser }) => {
    await cleanupTestList(browser, LIST_NAME);
  });

  test.beforeEach(async ({ page }) => {
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
  });

  /** リストの ⋮ メニューから「定期TODO」を選び、スケジュール管理ダイアログを開く */
  async function openScheduleDialog(page: Page) {
    const listRow = page
      .locator('[data-testid="list-item"]')
      .filter({ hasText: LIST_NAME });
    await listRow.hover();
    await listRow.locator('[data-testid="list-menu-btn"]').click();
    await page.click('[data-testid="list-schedules-btn"]');
    await page.locator('[data-testid="schedule-dialog"]').waitFor({
      timeout: 15000,
    });
  }

  /** 追加フォームを開き、タイトル入力 + 毎週月曜日の繰り返しルールで確定する */
  async function createWeeklySchedule(page: Page, title: string) {
    await page.click('[data-testid="schedule-add-btn"]');
    await page.fill('[data-testid="schedule-title-input"]', title);
    await page.locator('[data-testid="recurrence-editor"]').waitFor();
    await page
      .locator('[data-testid="recur-weekday-group"] button')
      .first()
      .click();
    await page.click('[data-testid="recur-submit-btn"]');
    await expect(
      page.locator('[data-testid="schedule-item"]').filter({ hasText: title }),
    ).toBeVisible({ timeout: 15000 });
  }

  test("定期TODOの作成とスケジュール一覧への表示", async ({ page }) => {
    const title = `週次TODO_${Date.now()}`;
    await openScheduleDialog(page);
    await createWeeklySchedule(page, title);

    const item = page
      .locator('[data-testid="schedule-item"]')
      .filter({ hasText: title });
    await expect(
      item.locator('[data-testid="schedule-summary"]'),
    ).toContainText("曜日");
  });

  test("定期TODOの編集で繰り返し条件が更新される", async ({ page }) => {
    const title = `編集TODO_${Date.now()}`;
    await openScheduleDialog(page);
    await createWeeklySchedule(page, title);

    const item = page
      .locator('[data-testid="schedule-item"]')
      .filter({ hasText: title });
    await item.locator('[data-testid="schedule-edit-btn"]').click();
    await page.locator('[data-testid="recurrence-editor"]').waitFor();
    await page.selectOption('[data-testid="recur-freq-select"]', "DAILY");
    await page.click('[data-testid="recur-submit-btn"]');

    await expect(item.locator('[data-testid="schedule-summary"]')).toHaveText(
      "毎日",
      { timeout: 15000 },
    );
  });

  test("定期TODOの無効化切替が一覧へ反映される", async ({ page }) => {
    const title = `無効化TODO_${Date.now()}`;
    await openScheduleDialog(page);
    await createWeeklySchedule(page, title);

    const item = page
      .locator('[data-testid="schedule-item"]')
      .filter({ hasText: title });
    const toggle = item.locator('[data-testid="schedule-enabled-toggle"]');
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(item).toHaveClass(/opacity-50/, { timeout: 15000 });
    await expect(toggle).not.toBeChecked();
  });

  test("定期TODOの削除で一覧から消える", async ({ page }) => {
    const title = `削除TODO_${Date.now()}`;
    await openScheduleDialog(page);
    await createWeeklySchedule(page, title);

    const item = page
      .locator('[data-testid="schedule-item"]')
      .filter({ hasText: title });
    await item.locator('[data-testid="schedule-delete-btn"]').click();
    await page
      .locator('[role="dialog"] button:has-text("削除")')
      .last()
      .click();

    await expect(item).not.toBeVisible({ timeout: 15000 });
  });
});
