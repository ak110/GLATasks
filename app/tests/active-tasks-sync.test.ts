/**
 * @fileoverview activeTasks 差分sync・楽観的更新・SSE経路の e2e テスト
 */

import { test, expect } from "@playwright/test";
import {
  BASE_URL,
  STORAGE_STATE_PATH,
  setupTestList,
  cleanupTestList,
  toggleTaskAndWaitForUpdate,
  waitForTaskUpdateResponse,
} from "./helpers/common";

const STAMP = Date.now();

test.describe("activeTasks 差分sync・楽観的更新", () => {
  // ---------------------------------------------------------------------------
  // シナリオ1: リスト切替がフェッチを経由せず即時表示される
  // ---------------------------------------------------------------------------
  test("リスト切替で差分syncが発火せず即時表示される", async ({ browser }) => {
    const listAName = `切替A_${STAMP}`;
    const listBName = `切替B_${STAMP}`;
    const taskATitle = `タスクA_${STAMP}`;
    const taskBTitle = `タスクB_${STAMP}`;

    // リストA・Bとそれぞれのタスクを準備する
    await setupTestList(browser, listAName);
    await setupTestList(browser, listBName);

    const ctx = await browser.newContext({
      baseURL: BASE_URL,
      storageState: STORAGE_STATE_PATH,
      ignoreHTTPSErrors: true,
    });

    try {
      const page = await ctx.newPage();

      // 初期ロード: tRPCレスポンスを待ってhydration完了を確保する
      await Promise.all([
        page.goto("/"),
        page.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);

      // リストAへ切り替えてタスクを追加する
      await page.click(
        `[data-testid="list-select-btn"]:has-text("${listAName}")`,
      );
      await page
        .locator('[data-testid="task-add-form"]')
        .waitFor({ timeout: 15000 });
      await page.fill('textarea[placeholder*="タスクを追加"]', taskATitle);
      await Promise.all([
        page
          .locator('[data-testid="task-add-form"] button[type="submit"]')
          .click(),
        page.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);
      await expect(
        page
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskATitle }),
      ).toBeVisible({ timeout: 15000 });

      // リストBへ切り替えてタスクを追加する
      await page.click(
        `[data-testid="list-select-btn"]:has-text("${listBName}")`,
      );
      await page
        .locator('[data-testid="task-add-form"]')
        .waitFor({ timeout: 15000 });
      await page.fill('textarea[placeholder*="タスクを追加"]', taskBTitle);
      await Promise.all([
        page
          .locator('[data-testid="task-add-form"] button[type="submit"]')
          .click(),
        page.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);
      await expect(
        page
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskBTitle }),
      ).toBeVisible({ timeout: 15000 });

      // リストAに切り替えてタスクA1が表示されるのを待つ
      await page.click(
        `[data-testid="list-select-btn"]:has-text("${listAName}")`,
      );
      await expect(
        page
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskATitle }),
      ).toBeVisible({ timeout: 15000 });

      // 切替後のリクエストを記録するハンドラを仕掛ける
      // SSEの /api/events は除外し、/api/trpc リクエストのみカウントする
      let trpcRequestCount = 0;
      await page.route("**/api/trpc/**", async (route) => {
        const url = route.request().url();
        if (url.includes("/api/events")) {
          await route.continue();
          return;
        }
        trpcRequestCount++;
        await route.continue();
      });

      // リストBへ切り替える
      await page.click(
        `[data-testid="list-select-btn"]:has-text("${listBName}")`,
      );

      // リストB内のタスクB1が 500ms 以内に表示されることを検証する（即時表示）
      await expect(
        page
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskBTitle }),
      ).toBeVisible({ timeout: 500 });

      // 切替によって tasks.listActive（差分sync）が実行されないことを検証する
      // 切替後の短い時間だけ待機してからリクエスト数が0であることを確認する
      await page.waitForTimeout(300);
      // listActive リクエストが発火した場合は count > 0 になる
      // リスト切替だけでは trpc リクエストは不要な設計であることを確認する
      expect(trpcRequestCount).toBe(0);

      // ルートを解除する
      await page.unroute("**/api/trpc/**");
    } finally {
      await ctx.close();
      await cleanupTestList(browser, listAName);
      await cleanupTestList(browser, listBName);
    }
  });

  // ---------------------------------------------------------------------------
  // シナリオ2: タスク追加がネットワーク遅延下でもUI即応する（楽観的更新）
  // ---------------------------------------------------------------------------
  test("タスク追加が2秒遅延下でも500ms以内に一覧へ反映される", async ({
    browser,
  }) => {
    const listName = `楽観追加_${STAMP}`;
    await setupTestList(browser, listName);

    const ctx = await browser.newContext({
      baseURL: BASE_URL,
      storageState: STORAGE_STATE_PATH,
      ignoreHTTPSErrors: true,
    });

    try {
      const page = await ctx.newPage();

      await Promise.all([
        page.goto("/"),
        page.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);

      // テスト用リストへ切り替えてタスク追加フォームを開く
      await page.click(
        `[data-testid="list-select-btn"]:has-text("${listName}")`,
      );
      await page
        .locator('[data-testid="task-add-form"]')
        .waitFor({ timeout: 15000 });

      // /api/trpc リクエストを2秒遅延させる
      // SSEの /api/events を巻き込まないよう除外する
      await ctx.route("**/api/trpc/**", async (route) => {
        const url = route.request().url();
        if (url.includes("/api/events")) {
          await route.continue();
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        await route.continue();
      });

      const taskTitle = `楽観タスク_${STAMP}`;
      await page.fill('textarea[placeholder*="タスクを追加"]', taskTitle);
      await page
        .locator('[data-testid="task-add-form"] button[type="submit"]')
        .click();

      // mutation応答を待たずに、500ms以内にタスクが一覧に表示されることを検証する（楽観的更新）
      await expect(
        page
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskTitle }),
      ).toBeVisible({ timeout: 500 });

      // 遅延ルートを解除してからmutation応答完了を待つ
      await ctx.unroute("**/api/trpc/**");

      // mutation応答後（2秒後以降）も同タスクが残っていることを確認する
      // 仮ID→実IDの置き換えでタスクが消えていないことを検証する
      await expect(
        page
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskTitle }),
      ).toBeVisible({ timeout: 5000 });
    } finally {
      await ctx.close();
      await cleanupTestList(browser, listName);
    }
  });

  // ---------------------------------------------------------------------------
  // シナリオ3: タスク編集がネットワーク遅延下でもUI即応する（楽観的更新）
  // ---------------------------------------------------------------------------
  test("タスク編集（completed化）が2秒遅延下でも500ms以内に打ち消し線が表示される", async ({
    browser,
  }) => {
    const listName = `楽観編集_${STAMP}`;
    const taskTitle = `編集対象_${STAMP}`;
    await setupTestList(browser, listName);

    const ctx = await browser.newContext({
      baseURL: BASE_URL,
      storageState: STORAGE_STATE_PATH,
      ignoreHTTPSErrors: true,
    });

    try {
      const page = await ctx.newPage();

      await Promise.all([
        page.goto("/"),
        page.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);

      // テスト用リストへ切り替えてタスクを追加する
      await page.click(
        `[data-testid="list-select-btn"]:has-text("${listName}")`,
      );
      await page
        .locator('[data-testid="task-add-form"]')
        .waitFor({ timeout: 15000 });
      await page.fill('textarea[placeholder*="タスクを追加"]', taskTitle);
      await Promise.all([
        page
          .locator('[data-testid="task-add-form"] button[type="submit"]')
          .click(),
        page.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);

      const taskRow = page
        .locator('[data-testid="task-item"]')
        .filter({ hasText: taskTitle });
      await taskRow.waitFor({ timeout: 15000 });

      const checkbox = taskRow.locator('input[type="checkbox"]');

      // 遅延のない状態で active → running へ遷移させる
      await toggleTaskAndWaitForUpdate(page, checkbox);

      // 2回目のtasks.updateだけを2秒遅延させる
      await ctx.route("**/api/trpc/**", async (route) => {
        const url = route.request().url();
        if (!url.includes("/api/trpc/tasks.update")) {
          await route.continue();
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        await route.continue();
      });

      // 実行中から completed へ遷移させる
      const updateResponse = waitForTaskUpdateResponse(page);
      await checkbox.dispatchEvent("click");

      // mutation応答を待たずに、500ms以内に打ち消し線が表示されることを検証する（楽観的更新）
      await expect(
        taskRow.locator('[data-testid="task-text"].line-through'),
      ).toBeVisible({ timeout: 500 });
      const response = await updateResponse;
      if (!response.ok()) {
        throw new Error(`tasks.updateがHTTP ${response.status()}で失敗した`);
      }

      // 遅延ルートを解除する
      await ctx.unroute("**/api/trpc/**");
    } finally {
      await ctx.close();
      await cleanupTestList(browser, listName);
    }
  });

  // ---------------------------------------------------------------------------
  // シナリオ4: SSE再接続後の差分sync経路（取りこぼし更新の反映）
  // ---------------------------------------------------------------------------
  test("SSEブロック中に別コンテキストで追加したタスクが再接続後に反映される", async ({
    browser,
  }) => {
    const listName = `SSE再接続_${STAMP}`;
    const taskByCtxA = `コンテキストA_${STAMP}`;
    const taskByCtxB = `コンテキストB_${STAMP}`;
    await setupTestList(browser, listName);

    const ctxOptions = {
      baseURL: BASE_URL,
      storageState: STORAGE_STATE_PATH,
      ignoreHTTPSErrors: true,
    };

    const ctxA = await browser.newContext(ctxOptions);
    const ctxB = await browser.newContext(ctxOptions);

    try {
      // --- コンテキストA: リストを開いてタスクを1件追加する ---
      const pageA = await ctxA.newPage();
      await Promise.all([
        pageA.goto("/"),
        pageA.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);
      await pageA.click(
        `[data-testid="list-select-btn"]:has-text("${listName}")`,
      );
      await pageA
        .locator('[data-testid="task-add-form"]')
        .waitFor({ timeout: 15000 });
      await pageA.fill('textarea[placeholder*="タスクを追加"]', taskByCtxA);
      await Promise.all([
        pageA
          .locator('[data-testid="task-add-form"] button[type="submit"]')
          .click(),
        pageA.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);
      await expect(
        pageA
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskByCtxA }),
      ).toBeVisible({ timeout: 15000 });

      // コンテキストAのSSEをブロックする（SSE切断状態を再現する）
      await ctxA.route("**/api/events", (route) => route.abort());

      // --- コンテキストB: 同一storageStateで別ページを開いてタスクを追加する ---
      const pageB = await ctxB.newPage();
      await Promise.all([
        pageB.goto("/"),
        pageB.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);
      await pageB.click(
        `[data-testid="list-select-btn"]:has-text("${listName}")`,
      );
      await pageB
        .locator('[data-testid="task-add-form"]')
        .waitFor({ timeout: 15000 });
      await pageB.fill('textarea[placeholder*="タスクを追加"]', taskByCtxB);
      await Promise.all([
        pageB
          .locator('[data-testid="task-add-form"] button[type="submit"]')
          .click(),
        pageB.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);
      // コンテキストBでタスクが追加されたことを確認する
      await expect(
        pageB
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskByCtxB }),
      ).toBeVisible({ timeout: 15000 });

      // コンテキストAのSSEブロックを解除する
      // unroute で登録解除し、以降の /api/events 接続を通す
      await ctxA.unroute("**/api/events");

      // ページを再フォーカスして TanStack Query の focus 時 invalidate を起動する
      await pageA.evaluate(() => window.dispatchEvent(new Event("focus")));

      // コンテキストAのタスク一覧にコンテキストBで追加したタスクが現れることを検証する
      // SSEの自動再接続と差分sync完了を待つため、タイムアウトを15秒に設定する
      await expect(
        pageA
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskByCtxB }),
      ).toBeVisible({ timeout: 15000 });
    } finally {
      // コンテキストB → A の順でクローズする
      await ctxB.close();
      await ctxA.close();
      await cleanupTestList(browser, listName);
    }
  });
});
