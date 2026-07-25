/**
 * @fileoverview タイマー機能の e2e テスト
 */

import {
  test,
  expect,
  type Page,
  type Locator,
  type Request,
} from "@playwright/test";
import { BASE_URL, STORAGE_STATE_PATH } from "./helpers/common";

/**
 * タイマーカードを削除する。
 * 通常削除（ConfirmDialog 表示）と一時タイマー満了時の確認なし削除の双方を扱う。
 */
async function deleteTimerCard(page: Page, card: Locator, skipConfirm = false) {
  await card.locator('[data-testid="timer-delete-btn"]').click();
  if (!skipConfirm) {
    await page
      .locator('[role="dialog"] button:has-text("削除")')
      .last()
      .click();
  }
  await expect(card).not.toBeVisible({ timeout: 10000 });
}

test.describe("timers", () => {
  test.beforeEach(async ({ page }) => {
    // SSE 接続が常時開いているため networkidle は利用できない
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
    await deleteTimerCard(page, card);
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
    await deleteTimerCard(page, card);
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
    await deleteTimerCard(page, card);
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
    await deleteTimerCard(page, card);
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
    await deleteTimerCard(page, card);
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
    await deleteTimerCard(page, card);
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
    await deleteTimerCard(page, card);
  });

  test("SSE 取りこぼし状態のブラウザでも、既に他端末で削除済みのタイマーを削除しようとしてエラーにならない", async ({
    browser,
  }) => {
    // ブラウザ A でタイマーを削除したあと、SSE イベントを受け取れていない
    // 別ブラウザ B が同じタイマーを削除しようとするケース。
    // 冪等な削除 API のため、B 側もエラートーストが出ず正常完了する。
    const timerName = `冪等削除_${Date.now()}`;

    const ctxA = await browser.newContext({
      storageState: STORAGE_STATE_PATH,
      ignoreHTTPSErrors: true,
      baseURL: BASE_URL,
    });
    // ブラウザ B は SSE エンドポイントへの接続を遮断する (= 切断中の状態を模擬)
    const ctxB = await browser.newContext({
      storageState: STORAGE_STATE_PATH,
      ignoreHTTPSErrors: true,
      baseURL: BASE_URL,
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

      // B でタイマー一覧を初期ロード（この時点でタイマーが表示されている）
      await Promise.all([
        pageB.goto("/timers"),
        pageB.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);
      const cardB = pageB
        .locator('[data-testid="timer-card"]')
        .filter({ hasText: timerName });
      await expect(cardB).toBeVisible({ timeout: 10000 });

      // A で削除 (B は SSE を遮断しているので通知されない)
      await deleteTimerCard(pageA, cardA);

      // B 側ではタイマーがまだ表示されている (取りこぼしを模擬)
      await expect(cardB).toBeVisible();

      // B で削除を試みる → 冪等なためエラートーストが出ず、カードが消える
      await deleteTimerCard(pageB, cardB);
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
    await deleteTimerCard(page, newCard);
  });

  test("一時タイマーを追加し満了時に確認なしで削除できる", async ({ page }) => {
    const timerName = `一時_${Date.now()}`;

    // 一時追加ボタンをクリック → 専用タイトルのダイアログが開く
    await page.click('[data-testid="timer-add-ephemeral-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await expect(page.locator('[data-testid="timer-dialog-title"]')).toHaveText(
      "一時タイマー追加",
    );

    // 2 秒タイマーとして送信
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "00:00:02");
    await page.click('[data-testid="timer-submit-btn"]');
    await page.waitForResponse((res) => res.url().includes("/api/trpc"));

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    // タイマー開始 → 残り 0 秒到達を待つ
    await card.locator('[data-testid="timer-start-btn"]').click();
    await expect(card.locator('[data-testid="timer-display"]')).toHaveText(
      "00:00:00",
      { timeout: 10000 },
    );

    // confirm を受け入れるリスナーは敢えて設定しない。
    // 一時タイマーの満了状態では confirm が発火しないため、
    // リスナー無しでも削除が成立することを確認する。
    await card.locator('[data-testid="timer-delete-btn"]').click();
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });

  test("鳴らす時間の秒数指定と既定値保存が機能する", async ({ page }) => {
    const timerName = `鳴動秒数_${Date.now()}`;

    // 既定値テストは前回テスト失敗時の状態が残ると誤判定するため、
    // 冒頭で確実に既定値（3秒）へリセットしてから本題に入る
    const ringInput = page.locator('[data-testid="timer-ring-seconds-input"]');
    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await ringInput.fill("3");
    await page.fill('[data-testid="timer-adjust-input"]', "10");
    await page.click('[data-testid="timer-save-default-btn"]');
    await page.waitForResponse((res) => res.url().includes("/api/trpc"));
    await page.keyboard.press("Escape");

    // リセット後の状態でダイアログを再度開く
    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();

    // 鳴らす時間の初期値は3秒
    await expect(ringInput).toHaveValue("3");

    // 値を変更し、既定として保存
    await page.fill('[data-testid="timer-adjust-input"]', "7");
    await ringInput.fill("120");
    await page.click('[data-testid="timer-save-default-btn"]');
    await page.waitForResponse((res) => res.url().includes("/api/trpc"));

    // タイマーを作成
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "00:05:00");
    await page.click('[data-testid="timer-submit-btn"]');
    await page.waitForResponse((res) => res.url().includes("/api/trpc"));

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    // ダイアログを再度開くと、既定値が反映される
    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await expect(ringInput).toHaveValue("120");
    await expect(
      page.locator('[data-testid="timer-adjust-input"]'),
    ).toHaveValue("7");

    // ダイアログを閉じる
    await page.keyboard.press("Escape");

    // 後片付け
    await deleteTimerCard(page, card);

    // 既定値をリセットして次のテストへ影響を残さない
    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await ringInput.fill("3");
    await page.fill('[data-testid="timer-adjust-input"]', "10");
    await page.click('[data-testid="timer-save-default-btn"]');
    await page.waitForResponse((res) => res.url().includes("/api/trpc"));
    await page.keyboard.press("Escape");
  });

  test("数値入力欄の未入力・範囲外はブラウザ側の検証で送信が止まる", async ({
    page,
  }) => {
    const timerName = `入力検証_${Date.now()}`;
    const adjustInput = page.locator('[data-testid="timer-adjust-input"]');
    const ringInput = page.locator('[data-testid="timer-ring-seconds-input"]');
    const dialogTitle = page.locator('[data-testid="timer-dialog-title"]');

    // 検証で止まる場合はサーバーへ送信しないことを確認するため mutation を数える。
    // クエリの定期再取得は GET のため POST に限定して数える。
    let trpcMutationCount = 0;
    const countTrpcMutation = (req: Request) => {
      if (req.method() === "POST" && req.url().includes("/api/trpc")) {
        trpcMutationCount += 1;
      }
    };
    page.on("request", countTrpcMutation);

    try {
      await page.click('[data-testid="timer-add-btn"]');
      await page.locator('[data-testid="timer-name-input"]').waitFor();
      await page.fill('[data-testid="timer-name-input"]', timerName);
      await page.fill('[data-testid="timer-base-time-input"]', "00:05:00");

      // 鳴らす時間が未入力の場合は送信ボタンで入力を促す検証エラーになる
      await ringInput.fill("");
      await page.click('[data-testid="timer-submit-btn"]');
      expect(
        await ringInput.evaluate(
          (el: HTMLInputElement) => el.validity.valueMissing,
        ),
      ).toBe(true);
      await expect(dialogTitle).toBeVisible();

      // 鳴らす時間が上限超過の場合は範囲の検証エラーになる
      await ringInput.fill("5000");
      await page.click('[data-testid="timer-submit-btn"]');
      expect(
        await ringInput.evaluate(
          (el: HTMLInputElement) => el.validity.rangeOverflow,
        ),
      ).toBe(true);
      await expect(dialogTitle).toBeVisible();

      // 延長/削減の単位が未入力の場合は既定値保存ボタンでも検証エラーになる
      await ringInput.fill("3");
      await adjustInput.fill("");
      await page.click('[data-testid="timer-save-default-btn"]');
      expect(
        await adjustInput.evaluate(
          (el: HTMLInputElement) => el.validity.valueMissing,
        ),
      ).toBe(true);

      // 延長/削減の単位が下限未満の場合も既定値保存ボタンで検証エラーになる
      await adjustInput.fill("0");
      await page.click('[data-testid="timer-save-default-btn"]');
      expect(
        await adjustInput.evaluate(
          (el: HTMLInputElement) => el.validity.rangeUnderflow,
        ),
      ).toBe(true);

      // いずれの操作もサーバーへ送信していない
      expect(trpcMutationCount).toBe(0);
    } finally {
      page.off("request", countTrpcMutation);
    }

    // ダイアログを閉じ、タイマーが作成されていないことを確認する
    await page.keyboard.press("Escape");
    await expect(dialogTitle).not.toBeVisible();
    await expect(
      page.locator('[data-testid="timer-card"]').filter({ hasText: timerName }),
    ).toHaveCount(0);
  });

  test("一時タイマーは未満了だと通常どおり確認ダイアログが出る", async ({
    page,
  }) => {
    const timerName = `一時未満了_${Date.now()}`;

    // 一時タイマーを長めの時間で作成
    await page.click('[data-testid="timer-add-ephemeral-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "01:00:00");
    await page.click('[data-testid="timer-submit-btn"]');
    await page.waitForResponse((res) => res.url().includes("/api/trpc"));

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    // 開始せずに削除 → ConfirmDialog が表示されることを検証
    await card.locator('[data-testid="timer-delete-btn"]').click();
    const confirmDialog = page.locator('[role="dialog"]', {
      hasText: "削除",
    });
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await confirmDialog.locator('button:has-text("削除")').last().click();
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });
});
