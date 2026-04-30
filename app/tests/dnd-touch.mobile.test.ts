/**
 * @fileoverview モバイル相当の viewport における D&D 関連 e2e テスト
 *
 * 目的:
 *
 * - モバイルブレークポイントでも `⠿` ドラッグハンドルが表示されることを確認する
 *   （タッチ対応の前提条件であり、CSS 修正の回帰検知に使う）
 *
 * 並び替え動作そのものの自動検証は chromium プロジェクト側
 * （`tasks.test.ts` の「ドラッグハンドルでタスクを並び替えできる」）で実施する。
 * 実タッチ入力での動作確認は Chrome DevTools のデバイスエミュレーション等で
 * 手動検証する想定（Playwright の mobile emulation 下では mouse 入力経由の
 * Pointer Events 自動駆動が安定しないため、自動化スコープからは外している）。
 */

import { test, expect } from "@playwright/test";

test.describe("dnd reorder (mobile viewport)", () => {
  test("モバイルブレークポイントでドラッグハンドルが表示される", async ({
    page,
  }) => {
    const stamp = Date.now();
    const timerName = `モバ_${stamp}`;

    await Promise.all([
      page.goto("/timers"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);

    // タイマーを 1 件作成してハンドル表示を検証する
    await page.locator('[data-testid="timer-add-btn"]').click();
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "00:01:00");
    await Promise.all([
      page.locator('[data-testid="timer-submit-btn"]').click(),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    // モバイル viewport でもドラッグハンドルが表示されること
    // （旧実装では `hidden ... sm:inline` でモバイル時に非表示だった）
    await expect(
      card.locator('[data-testid="timer-drag-handle"]'),
    ).toBeVisible();

    // 後片付け: ConfirmDialog の「削除」ボタンを押下する
    await card.locator('[data-testid="timer-delete-btn"]').click();
    await page
      .locator('[role="dialog"] button:has-text("削除")')
      .last()
      .click();
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });
});
