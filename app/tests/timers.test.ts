/**
 * @fileoverview タイマー機能の e2e テスト
 */

import { test, expect } from "@playwright/test";

test.describe("timers", () => {
  test.beforeEach(async ({ page }) => {
    // SSE 接続が常時開いているため networkidle は使えない
    await Promise.all([
      page.goto("/timers"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
  });

  test("タイマーページが表示される", async ({ page }) => {
    await expect(page.locator("h1")).toHaveText("タイマー");
    await expect(page.locator('[data-testid="timer-add-btn"]')).toBeVisible();
  });

  test("タイマーを追加すると一覧に表示される", async ({ page }) => {
    const timerName = `テスト_${Date.now()}`;

    // 追加ボタンをクリック
    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();

    // フォームを入力
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "00:05:00");

    // 送信
    await page.click('[data-testid="timer-submit-btn"]');
    await page.waitForResponse((res) => res.url().includes("/api/trpc"));

    // タイマーカードが表示される
    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card.locator('[data-testid="timer-display"]')).toHaveText(
      "00:05:00",
    );

    // 後片付け
    page.once("dialog", (dialog) => dialog.accept());
    await card.locator('[data-testid="timer-delete-btn"]').click();
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });

  test("タイマーを開始・一時停止できる", async ({ page }) => {
    const timerName = `開始停止_${Date.now()}`;

    // タイマー作成
    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "00:01:00");
    await page.click('[data-testid="timer-submit-btn"]');

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    // 開始
    await card.locator('[data-testid="timer-start-btn"]').click();
    await expect(card.locator('[data-testid="timer-pause-btn"]')).toBeVisible({
      timeout: 5000,
    });

    // 少し待つ
    await page.waitForTimeout(1500);

    // 一時停止
    await card.locator('[data-testid="timer-pause-btn"]').click();
    await expect(card.locator('[data-testid="timer-start-btn"]')).toBeVisible({
      timeout: 5000,
    });

    // 時間が減少していることを確認する（1 分 = 00:01:00 からの経過分）
    const display = await card
      .locator('[data-testid="timer-display"]')
      .textContent();
    expect(display).not.toBe("00:01:00");

    // 後片付け
    page.once("dialog", (dialog) => dialog.accept());
    await card.locator('[data-testid="timer-delete-btn"]').click();
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });

  test("タイマーをリセットできる", async ({ page }) => {
    const timerName = `リセット_${Date.now()}`;

    // タイマー作成
    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "00:02:30");
    await page.click('[data-testid="timer-submit-btn"]');

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    // 開始 → 少し待って → リセット
    await card.locator('[data-testid="timer-start-btn"]').click();
    await page.waitForTimeout(1500);
    await card.locator('[data-testid="timer-reset-btn"]').click();

    // リセット後は元の時間に戻る
    await expect(card.locator('[data-testid="timer-display"]')).toHaveText(
      "00:02:30",
      { timeout: 5000 },
    );

    // 後片付け
    page.once("dialog", (dialog) => dialog.accept());
    await card.locator('[data-testid="timer-delete-btn"]').click();
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });

  test("タイマーの延長・削減ができる", async ({ page }) => {
    const timerName = `延長削減_${Date.now()}`;

    // タイマー作成（5分、延長/削減=5分）
    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "00:05:00");
    await page.fill('[data-testid="timer-adjust-input"]', "5");
    await page.click('[data-testid="timer-submit-btn"]');

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    // +5分
    await card.locator('[data-testid="timer-plus-btn"]').click();
    await expect(card.locator('[data-testid="timer-display"]')).toHaveText(
      "00:10:00",
      { timeout: 5000 },
    );

    // -5分
    await card.locator('[data-testid="timer-minus-btn"]').click();
    await expect(card.locator('[data-testid="timer-display"]')).toHaveText(
      "00:05:00",
      { timeout: 5000 },
    );

    // 後片付け
    page.once("dialog", (dialog) => dialog.accept());
    await card.locator('[data-testid="timer-delete-btn"]').click();
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });

  test("アラームモードでタイマーを追加できる", async ({ page }) => {
    const timerName = `アラーム_${Date.now()}`;

    // 追加ボタンをクリック
    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();

    // フォームを入力
    await page.fill('[data-testid="timer-name-input"]', timerName);

    // アラームモードに切り替え
    await page.click('[data-testid="timer-mode-alarm"]');

    // 目標時刻を入力
    await page.fill('[data-testid="timer-target-time-input"]', "23:59");

    // 送信
    await page.click('[data-testid="timer-submit-btn"]');
    await page.waitForResponse((res) => res.url().includes("/api/trpc"));

    // タイマーカードが表示される
    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    // 目標時刻が表示される
    await expect(
      card.locator('[data-testid="timer-target-display"]'),
    ).toContainText("23:59");

    // アラームは自動スタートするのでカウントダウンが表示される
    const display = await card
      .locator('[data-testid="timer-display"]')
      .textContent();
    expect(display).not.toBe("00:00:00");

    // 後片付け
    page.once("dialog", (dialog) => dialog.accept());
    await card.locator('[data-testid="timer-delete-btn"]').click();
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });

  test("アラームモードの±ボタンで目標時刻がずれる", async ({ page }) => {
    const timerName = `アラーム±_${Date.now()}`;

    // アラームタイマー作成
    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.click('[data-testid="timer-mode-alarm"]');
    await page.fill('[data-testid="timer-target-time-input"]', "12:00");
    await page.fill('[data-testid="timer-adjust-input"]', "10");
    await page.click('[data-testid="timer-submit-btn"]');

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(
      card.locator('[data-testid="timer-target-display"]'),
    ).toContainText("12:00");

    // +10分
    await card.locator('[data-testid="timer-plus-btn"]').click();
    await expect(
      card.locator('[data-testid="timer-target-display"]'),
    ).toContainText("12:10", { timeout: 5000 });

    // -10分で戻る
    await card.locator('[data-testid="timer-minus-btn"]').click();
    await expect(
      card.locator('[data-testid="timer-target-display"]'),
    ).toContainText("12:00", { timeout: 5000 });

    // 後片付け
    page.once("dialog", (dialog) => dialog.accept());
    await card.locator('[data-testid="timer-delete-btn"]').click();
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });

  test("アラームモードのリセットで再計算される", async ({ page }) => {
    const timerName = `アラームReset_${Date.now()}`;

    // アラームタイマー作成
    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.click('[data-testid="timer-mode-alarm"]');
    await page.fill('[data-testid="timer-target-time-input"]', "23:59");
    await page.click('[data-testid="timer-submit-btn"]');

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    // リセットで停止＆再計算される
    await card.locator('[data-testid="timer-reset-btn"]').click();
    await page.waitForResponse((res) => res.url().includes("/api/trpc"));

    // 開始ボタンが表示される（停止状態）
    await expect(card.locator('[data-testid="timer-start-btn"]')).toBeVisible({
      timeout: 5000,
    });

    // 停止中アラームではカウントダウン非表示、目標時刻のみ表示される
    await expect(
      card.locator('[data-testid="timer-display"]'),
    ).not.toBeVisible();
    await expect(
      card.locator('[data-testid="timer-target-display"]'),
    ).toBeVisible();
    const targetText = await card
      .locator('[data-testid="timer-target-display"]')
      .textContent();
    expect(targetText).toContain("23:59");

    // 後片付け
    page.once("dialog", (dialog) => dialog.accept());
    await card.locator('[data-testid="timer-delete-btn"]').click();
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });

  test("SSE 取りこぼし状態のブラウザでも、既に他端末で削除済みのタイマーを削除しようとしてエラーにならない", async ({
    browser,
  }) => {
    // ブラウザ A でタイマーを削除したあと、SSE イベントを受け取れていない
    // 別ブラウザ B が同じタイマーを削除しようとするケース。
    // 冪等な削除 API のため、B 側もエラートーストが出ず正常完了する。
    const timerName = `冪等削除_${Date.now()}`;

    const ctxA = await browser.newContext({
      storageState: "app/tests/.auth/user.json",
      ignoreHTTPSErrors: true,
      baseURL: process.env.BASE_URL ?? "https://localhost:38180",
    });
    // ブラウザ B は SSE エンドポイントへの接続を遮断する (= 切断中の状態を模擬)
    const ctxB = await browser.newContext({
      storageState: "app/tests/.auth/user.json",
      ignoreHTTPSErrors: true,
      baseURL: process.env.BASE_URL ?? "https://localhost:38180",
    });
    await ctxB.route("**/api/events", (route) => route.abort());

    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      await Promise.all([
        pageA.goto("/timers"),
        pageA.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);

      // A でタイマー作成
      await pageA.click('[data-testid="timer-add-btn"]');
      await pageA.locator('[data-testid="timer-name-input"]').waitFor();
      await pageA.fill('[data-testid="timer-name-input"]', timerName);
      await pageA.fill('[data-testid="timer-base-time-input"]', "00:01:00");
      await pageA.click('[data-testid="timer-submit-btn"]');

      const cardA = pageA
        .locator('[data-testid="timer-card"]')
        .filter({ hasText: timerName });
      await expect(cardA).toBeVisible({ timeout: 10000 });

      // B でタイマー一覧を初期ロード (この時点ではタイマーが見える)
      await Promise.all([
        pageB.goto("/timers"),
        pageB.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);
      const cardB = pageB
        .locator('[data-testid="timer-card"]')
        .filter({ hasText: timerName });
      await expect(cardB).toBeVisible({ timeout: 10000 });

      // A で削除 (B は SSE を遮断しているので通知されない)
      pageA.once("dialog", (dialog) => dialog.accept());
      await cardA.locator('[data-testid="timer-delete-btn"]').click();
      await expect(cardA).not.toBeVisible({ timeout: 10000 });

      // B 側ではタイマーがまだ表示されている (取りこぼしを模擬)
      await expect(cardB).toBeVisible();

      // B で削除を試みる → 冪等なためエラートーストが出ず、カードが消える
      pageB.once("dialog", (dialog) => dialog.accept());
      await cardB.locator('[data-testid="timer-delete-btn"]').click();
      await expect(cardB).not.toBeVisible({ timeout: 10000 });
      // エラートーストが出ていないこと
      await expect(pageB.locator('[data-testid="toast-error"]')).toHaveCount(0);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("タイマーを編集できる", async ({ page }) => {
    const timerName = `編集前_${Date.now()}`;
    const newName = `編集後_${Date.now()}`;

    // タイマー作成
    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "00:03:00");
    await page.click('[data-testid="timer-submit-btn"]');

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    // 編集ダイアログを開く
    await card.locator('[data-testid="timer-edit-btn"]').click();
    await page.locator('[data-testid="timer-name-input"]').waitFor();

    // 名前を変更
    await page.fill('[data-testid="timer-name-input"]', newName);
    await page.click('[data-testid="timer-submit-btn"]');

    // 名前が変更されている
    const newCard = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: newName });
    await expect(newCard).toBeVisible({ timeout: 10000 });

    // 後片付け
    page.once("dialog", (dialog) => dialog.accept());
    await newCard.locator('[data-testid="timer-delete-btn"]').click();
    await expect(newCard).not.toBeVisible({ timeout: 10000 });
  });
});
