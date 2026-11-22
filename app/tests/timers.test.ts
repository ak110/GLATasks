import { uniqueTestName, makeContextOptions } from "./helpers/common";
import {
  test,
  expect,
  type Page,
  type Locator,
  type Request,
} from "@playwright/test";

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

  test("タイマー状態回帰: 別タイマーの実行中も再満了を通知する", async ({
    page,
  }) => {
    const names = [uniqueTestName("通知再実行"), uniqueTestName("実行継続")];
    const cards = names.map((name) =>
      page.getByTestId("timer-card").filter({ hasText: name }),
    );
    try {
      for (const [index, name] of names.entries()) {
        await page.getByTestId("timer-add-btn").click();
        await page.getByTestId("timer-name-input").fill(name);
        await page
          .getByTestId("timer-base-time-input")
          .fill(index === 0 ? "00:00:02" : "00:10:00");
        await page.getByTestId("timer-adjust-input").fill("1");
        await page.getByTestId("timer-ring-seconds-input").fill("1");
        await page.getByTestId("timer-submit-btn").click();
        await expect(cards[index]).toBeVisible();
      }
      await cards[1].getByTestId("timer-start-btn").click();
      await expect(cards[1].getByTestId("timer-pause-btn")).toBeVisible();
      await cards[0].getByTestId("timer-start-btn").click();
      const toast = page.getByText(`${names[0]} 完了`, { exact: true });
      await expect(toast).toBeVisible({ timeout: 10000 });
      await toast
        .locator("..")
        .getByRole("button", { name: "タイマー完了の通知を閉じる" })
        .click();
      await expect(toast).not.toBeVisible();
      await cards[0].getByTestId("timer-reset-btn").click();
      await expect(cards[0].getByTestId("timer-display")).toHaveText(
        "00:00:02",
      );
      await cards[0].getByTestId("timer-start-btn").click();
      await expect(toast).toBeVisible({ timeout: 10000 });
      await expect(cards[1].getByTestId("timer-pause-btn")).toBeVisible();
    } finally {
      for (const card of cards)
        if (await card.count()) await deleteTimerCard(page, card);
    }
  });

  test("タイマー状態回帰: 保存応答は新しい編集セッションを閉じない", async ({
    page,
  }) => {
    const names = [uniqueTestName("編集A"), uniqueTestName("編集B")];
    const cards = names.map((name) =>
      page.getByTestId("timer-card").filter({ hasText: name }),
    );
    let release = () => {};
    try {
      for (const [index, name] of names.entries()) {
        await page.getByTestId("timer-add-btn").click();
        await page.getByTestId("timer-name-input").fill(name);
        await page.getByTestId("timer-base-time-input").fill("00:05:00");
        await page.getByTestId("timer-adjust-input").fill("1");
        await page.getByTestId("timer-submit-btn").click();
        await expect(cards[index]).toBeVisible();
      }
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let received = () => {};
      const started = new Promise<void>((resolve) => {
        received = resolve;
      });
      await page.route("**/api/trpc/**", async (route) => {
        if (
          route.request().method() !== "POST" ||
          !route.request().url().includes("timers.update")
        )
          return route.continue();
        const response = await route.fetch();
        received();
        await held;
        await route.fulfill({ response });
      });
      await cards[0].getByTestId("timer-edit-btn").click();
      await page.getByTestId("timer-submit-btn").click();
      await started;
      await page.keyboard.press("Escape");
      await cards[1].getByTestId("timer-edit-btn").click();
      await expect(page.getByTestId("timer-name-input")).toHaveValue(names[1]);
      const completed = page.waitForResponse(
        (response) =>
          response.url().includes("timers.update") &&
          response.request().method() === "POST",
      );
      release();
      await completed;
      await expect(
        page.getByRole("dialog", { name: "タイマー編集" }),
      ).toBeVisible();
      await expect(page.getByTestId("timer-name-input")).toHaveValue(names[1]);
    } finally {
      release();
      await page.unroute("**/api/trpc/**");
      await page.keyboard.press("Escape");
      for (const card of cards)
        if (await card.count()) await deleteTimerCard(page, card);
    }
  });

  test("タイマー状態回帰: 初回取得エラーから再試行できる", async ({ page }) => {
    await page.route("**/api/trpc/**", async (route) => {
      if (route.request().url().includes("timers.list"))
        return route.fulfill({ status: 500 });
      return route.continue();
    });
    await page.reload();
    const retry = page.getByRole("button", { name: "再試行" });
    await expect(retry).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText("タイマーがありません", { exact: true }),
    ).not.toBeVisible();
    await page.unroute("**/api/trpc/**");
    await retry.click();
    await expect(retry).not.toBeVisible();
  });

  test("タイマー入力回帰: 保存中の新入力を保持し二重送信を防ぐ", async ({
    page,
  }) => {
    const name = uniqueTestName("入力保持");
    const card = page.getByTestId("timer-card").filter({ hasText: name });
    let release = () => {};
    try {
      await page.getByTestId("timer-add-btn").click();
      await page.getByTestId("timer-name-input").fill(name);
      await page.getByTestId("timer-base-time-input").fill("00:05:00");
      await page.getByTestId("timer-adjust-input").fill("1");
      await page.getByTestId("timer-submit-btn").click();
      await expect(card).toBeVisible();
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let received = () => {};
      const started = new Promise<void>((resolve) => {
        received = resolve;
      });
      let mutationCount = 0;
      await page.route("**/api/trpc/**", async (route) => {
        if (
          route.request().method() !== "POST" ||
          !route.request().url().includes("timers.update")
        )
          return route.continue();
        mutationCount++;
        const response = await route.fetch();
        received();
        await held;
        await route.fulfill({ response });
      });
      await card.getByTestId("timer-edit-btn").click();
      await page.getByTestId("timer-submit-btn").click();
      await started;
      await expect(page.getByTestId("timer-submit-btn")).toBeDisabled();
      await page.getByTestId("timer-name-input").fill("保存完了前の新入力");
      await page
        .getByTestId("timer-submit-btn")
        .evaluate((button: HTMLButtonElement) =>
          button.form?.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
        );
      const completed = page.waitForResponse(
        (response) =>
          response.url().includes("timers.update") &&
          response.request().method() === "POST",
      );
      release();
      await completed;
      await expect(page.getByTestId("timer-name-input")).toHaveValue(
        "保存完了前の新入力",
      );
      await expect(page.getByTestId("timer-submit-btn")).toBeEnabled();
      expect(mutationCount).toBe(1);
    } finally {
      release();
      await page.unroute("**/api/trpc/**");
      await page.keyboard.press("Escape");
      if (await card.count()) await deleteTimerCard(page, card);
    }
  });

  test("タイマーを追加すると一覧に表示される", async ({ page }) => {
    const timerName = `テスト_${uniqueTestName("e2e")}`;

    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();

    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "00:05:00");

    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
      page.click('[data-testid="timer-submit-btn"]'),
    ]);

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card.locator('[data-testid="timer-display"]')).toHaveText(
      "00:05:00",
    );
    await expect(card.locator('[data-testid="timer-start-btn"]')).toBeVisible();

    await deleteTimerCard(page, card);
  });

  test("タイマーを開始・一時停止できる", async ({ page }) => {
    const timerName = `開始停止_${uniqueTestName("e2e")}`;

    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "00:01:00");
    await page.click('[data-testid="timer-submit-btn"]');

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    await card.locator('[data-testid="timer-start-btn"]').click();
    await expect(card.locator('[data-testid="timer-pause-btn"]')).toBeVisible({
      timeout: 5000,
    });

    await expect(card.getByTestId("timer-display")).toHaveText(
      /^00:00:(?:[0-4]\d|5[0-8])$/,
    );

    await card.locator('[data-testid="timer-pause-btn"]').click();
    await expect(card.locator('[data-testid="timer-start-btn"]')).toBeVisible({
      timeout: 5000,
    });

    await expect(card.getByTestId("timer-display")).toHaveText(
      /^00:00:[0-5]\d$/,
    );

    await deleteTimerCard(page, card);
  });

  test("タイマーをリセットできる", async ({ page }) => {
    const timerName = `リセット_${uniqueTestName("e2e")}`;

    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "00:02:30");
    await page.click('[data-testid="timer-submit-btn"]');

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    await card.locator('[data-testid="timer-start-btn"]').click();
    await expect(card.getByTestId("timer-display")).not.toHaveText("00:02:30");
    await card.locator('[data-testid="timer-reset-btn"]').click();

    await expect(card.locator('[data-testid="timer-display"]')).toHaveText(
      "00:02:30",
      { timeout: 5000 },
    );

    await deleteTimerCard(page, card);
  });

  test("タイマーの延長・削減ができる", async ({ page }) => {
    const timerName = `延長削減_${uniqueTestName("e2e")}`;

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

    await card.locator('[data-testid="timer-plus-btn"]').click();
    await expect(card.locator('[data-testid="timer-display"]')).toHaveText(
      "00:10:00",
      { timeout: 5000 },
    );

    await card.locator('[data-testid="timer-minus-btn"]').click();
    await expect(card.locator('[data-testid="timer-display"]')).toHaveText(
      "00:05:00",
      { timeout: 5000 },
    );

    await deleteTimerCard(page, card);
  });

  test("アラームモードでタイマーを追加できる", async ({ page }) => {
    const timerName = `アラーム_${uniqueTestName("e2e")}`;

    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();

    await page.fill('[data-testid="timer-name-input"]', timerName);

    await page.click('[data-testid="timer-mode-alarm"]');

    await page.fill('[data-testid="timer-target-time-input"]', "23:59");

    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
      page.click('[data-testid="timer-submit-btn"]'),
    ]);

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    await expect(
      card.locator('[data-testid="timer-target-display"]'),
    ).toContainText("23:59");

    const display = await card
      .locator('[data-testid="timer-display"]')
      .textContent();
    expect(display).not.toBe("00:00:00");

    await deleteTimerCard(page, card);
  });

  test("アラームモードの±ボタンで目標時刻がずれる", async ({ page }) => {
    const timerName = `アラーム±_${uniqueTestName("e2e")}`;

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

    await card.locator('[data-testid="timer-plus-btn"]').click();
    await expect(
      card.locator('[data-testid="timer-target-display"]'),
    ).toContainText("12:10", { timeout: 5000 });

    await card.locator('[data-testid="timer-minus-btn"]').click();
    await expect(
      card.locator('[data-testid="timer-target-display"]'),
    ).toContainText("12:00", { timeout: 5000 });

    await deleteTimerCard(page, card);
  });

  test("アラームモードのリセットで再計算される", async ({ page }) => {
    const timerName = `アラームReset_${uniqueTestName("e2e")}`;

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

    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
      card.locator('[data-testid="timer-reset-btn"]').click(),
    ]);

    await expect(card.locator('[data-testid="timer-start-btn"]')).toBeVisible({
      timeout: 5000,
    });

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

    await deleteTimerCard(page, card);
  });

  test("SSE 取りこぼし状態のブラウザでも、既に他端末で削除済みのタイマーを削除しようとしてエラーにならない", async ({
    browser,
  }) => {
    const timerName = `冪等削除_${uniqueTestName("e2e")}`;

    const ctxA = await browser.newContext(makeContextOptions());
    const ctxB = await browser.newContext(makeContextOptions());
    await ctxB.route("**/api/events", (route) => route.abort());

    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      await Promise.all([
        pageA.goto("/timers"),
        pageA.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);

      await pageA.click('[data-testid="timer-add-btn"]');
      await pageA.locator('[data-testid="timer-name-input"]').waitFor();
      await pageA.fill('[data-testid="timer-name-input"]', timerName);
      await pageA.fill('[data-testid="timer-base-time-input"]', "00:01:00");
      await pageA.click('[data-testid="timer-submit-btn"]');

      const cardA = pageA
        .locator('[data-testid="timer-card"]')
        .filter({ hasText: timerName });
      await expect(cardA).toBeVisible({ timeout: 10000 });

      await Promise.all([
        pageB.goto("/timers"),
        pageB.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);
      const cardB = pageB
        .locator('[data-testid="timer-card"]')
        .filter({ hasText: timerName });
      await expect(cardB).toBeVisible({ timeout: 10000 });

      await deleteTimerCard(pageA, cardA);

      await expect(cardB).toBeVisible();

      await deleteTimerCard(pageB, cardB);
      await expect(pageB.locator('[data-testid="toast-error"]')).toHaveCount(0);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("タイマーを編集できる", async ({ page }) => {
    const timerName = `編集前_${uniqueTestName("e2e")}`;
    const newName = `編集後_${uniqueTestName("e2e")}`;

    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "00:03:00");
    await page.click('[data-testid="timer-submit-btn"]');

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    await card.locator('[data-testid="timer-edit-btn"]').click();
    await page.locator('[data-testid="timer-name-input"]').waitFor();

    await page.fill('[data-testid="timer-name-input"]', newName);
    await page.click('[data-testid="timer-submit-btn"]');

    const newCard = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: newName });
    await expect(newCard).toBeVisible({ timeout: 10000 });

    await deleteTimerCard(page, newCard);
  });

  test("一時タイマーを追加し満了時に確認なしで削除できる", async ({ page }) => {
    const timerName = `一時_${uniqueTestName("e2e")}`;

    await page.click('[data-testid="timer-add-ephemeral-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await expect(page.locator('[data-testid="timer-dialog-title"]')).toHaveText(
      "一時タイマー追加",
    );

    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "00:00:02");
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
      page.click('[data-testid="timer-submit-btn"]'),
    ]);

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    await expect(card.locator('[data-testid="timer-display"]')).toHaveText(
      "00:00:00",
      { timeout: 10000 },
    );

    await card.locator('[data-testid="timer-delete-btn"]').click();
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });

  test("鳴らす時間の秒数指定と既定値保存が機能する", async ({ page }) => {
    const timerName = `鳴動秒数_${uniqueTestName("e2e")}`;

    const ringInput = page.locator('[data-testid="timer-ring-seconds-input"]');
    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await ringInput.fill("3");
    await page.fill('[data-testid="timer-adjust-input"]', "10");
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
      page.click('[data-testid="timer-save-default-btn"]'),
    ]);
    await page.keyboard.press("Escape");

    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();

    await expect(ringInput).toHaveValue("3");

    await page.fill('[data-testid="timer-adjust-input"]', "7");
    await ringInput.fill("120");
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
      page.click('[data-testid="timer-save-default-btn"]'),
    ]);

    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "00:05:00");
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
      page.click('[data-testid="timer-submit-btn"]'),
    ]);

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await expect(ringInput).toHaveValue("120");
    await expect(
      page.locator('[data-testid="timer-adjust-input"]'),
    ).toHaveValue("7");

    await page.keyboard.press("Escape");

    await deleteTimerCard(page, card);

    await page.click('[data-testid="timer-add-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await ringInput.fill("3");
    await page.fill('[data-testid="timer-adjust-input"]', "10");
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
      page.click('[data-testid="timer-save-default-btn"]'),
    ]);
    await page.keyboard.press("Escape");
  });

  test("数値入力欄の未入力・範囲外はブラウザ側の検証で送信が止まる", async ({
    page,
  }) => {
    const timerName = `入力検証_${uniqueTestName("e2e")}`;
    const adjustInput = page.locator('[data-testid="timer-adjust-input"]');
    const ringInput = page.locator('[data-testid="timer-ring-seconds-input"]');
    const dialogTitle = page.locator('[data-testid="timer-dialog-title"]');

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

      await ringInput.fill("");
      await page.click('[data-testid="timer-submit-btn"]');
      expect(
        await ringInput.evaluate(
          (el: HTMLInputElement) => el.validity.valueMissing,
        ),
      ).toBe(true);
      await expect(dialogTitle).toBeVisible();

      await ringInput.fill("5000");
      await page.click('[data-testid="timer-submit-btn"]');
      expect(
        await ringInput.evaluate(
          (el: HTMLInputElement) => el.validity.rangeOverflow,
        ),
      ).toBe(true);
      await expect(dialogTitle).toBeVisible();

      await ringInput.fill("3");
      await adjustInput.fill("");
      await page.click('[data-testid="timer-save-default-btn"]');
      expect(
        await adjustInput.evaluate(
          (el: HTMLInputElement) => el.validity.valueMissing,
        ),
      ).toBe(true);

      await adjustInput.fill("0");
      await page.click('[data-testid="timer-save-default-btn"]');
      expect(
        await adjustInput.evaluate(
          (el: HTMLInputElement) => el.validity.rangeUnderflow,
        ),
      ).toBe(true);

      expect(trpcMutationCount).toBe(0);
    } finally {
      page.off("request", countTrpcMutation);
    }

    await page.keyboard.press("Escape");
    await expect(dialogTitle).not.toBeVisible();
    await expect(
      page.locator('[data-testid="timer-card"]').filter({ hasText: timerName }),
    ).toHaveCount(0);
  });

  test("一時タイマーは未満了だと通常どおり確認ダイアログが出る", async ({
    page,
  }) => {
    const timerName = `一時未満了_${uniqueTestName("e2e")}`;

    await page.click('[data-testid="timer-add-ephemeral-btn"]');
    await page.locator('[data-testid="timer-name-input"]').waitFor();
    await page.fill('[data-testid="timer-name-input"]', timerName);
    await page.fill('[data-testid="timer-base-time-input"]', "01:00:00");
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
      page.click('[data-testid="timer-submit-btn"]'),
    ]);

    const card = page
      .locator('[data-testid="timer-card"]')
      .filter({ hasText: timerName });
    await expect(card).toBeVisible({ timeout: 10000 });

    await expect(card.getByTestId("timer-pause-btn")).toBeVisible();
    await page.reload();
    await expect(card.getByTestId("timer-pause-btn")).toBeVisible();

    await card.locator('[data-testid="timer-delete-btn"]').click();
    const confirmDialog = page.locator('[role="dialog"]', {
      hasText: "削除",
    });
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await confirmDialog.locator('button:has-text("削除")').last().click();
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });
});
