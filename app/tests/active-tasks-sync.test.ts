import {
  isTrpcUrl,
  uniqueTestName,
  makeContextOptions,
  addTask,
  setupTestList,
  setupTestLists,
  cleanupTestList,
  cleanupTestLists,
  toggleTaskAndWaitForUpdate,
  waitForPersistedTask,
  waitForSuccessfulMutationResponse,
  waitForTaskUpdateResponse,
} from "./helpers/common";
import { test, expect, type Request } from "@playwright/test";

const STAMP = uniqueTestName("e2e");

test.describe("activeTasks 差分sync・楽観的更新", () => {
  test("リスト切替で差分syncが発火せず即時表示される", async ({ browser }) => {
    const listAName = `切替A_${STAMP}`;
    const listBName = `切替B_${STAMP}`;
    const taskATitle = `タスクA_${STAMP}`;
    const taskBTitle = `タスクB_${STAMP}`;

    await setupTestList(browser, listAName);
    await setupTestList(browser, listBName);

    const ctx = await browser.newContext(makeContextOptions());

    try {
      const page = await ctx.newPage();

      await Promise.all([
        page.goto("/"),
        page.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);

      await page.click(
        `[data-testid="list-select-btn"]:has-text("${listAName}")`,
      );
      await page
        .locator('[data-testid="task-add-form"]')
        .waitFor({ timeout: 15000 });
      await addTask(page, taskATitle);
      await expect(
        page
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskATitle }),
      ).toBeVisible({ timeout: 15000 });

      await page.click(
        `[data-testid="list-select-btn"]:has-text("${listBName}")`,
      );
      await page
        .locator('[data-testid="task-add-form"]')
        .waitFor({ timeout: 15000 });
      await addTask(page, taskBTitle);
      await expect(
        page
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskBTitle }),
      ).toBeVisible({ timeout: 15000 });

      await page.click(
        `[data-testid="list-select-btn"]:has-text("${listAName}")`,
      );
      await expect(
        page
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskATitle }),
      ).toBeVisible({ timeout: 15000 });

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

      await page.click(
        `[data-testid="list-select-btn"]:has-text("${listBName}")`,
      );

      await expect(
        page
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskBTitle }),
      ).toBeVisible({ timeout: 500 });

      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      expect(trpcRequestCount).toBe(0);

      await page.unroute("**/api/trpc/**");
    } finally {
      await ctx.close();
      await cleanupTestList(browser, listAName);
      await cleanupTestList(browser, listBName);
    }
  });

  test("タスク追加が2秒遅延下でも500ms以内に一覧へ反映される", async ({
    browser,
  }) => {
    const listName = `楽観追加_${STAMP}`;
    await setupTestList(browser, listName);

    const ctx = await browser.newContext(makeContextOptions());

    try {
      const page = await ctx.newPage();

      await Promise.all([
        page.goto("/"),
        page.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);

      await page.click(
        `[data-testid="list-select-btn"]:has-text("${listName}")`,
      );
      await page
        .locator('[data-testid="task-add-form"]')
        .waitFor({ timeout: 15000 });

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
      const createResponsePromise = page.waitForResponse((response) =>
        isTrpcUrl(response.url(), "tasks.create"),
      );
      await page
        .locator('[data-testid="task-add-form"] button[type="submit"]')
        .click();

      await expect(
        page
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskTitle }),
      ).toBeVisible({ timeout: 500 });

      const createResponse = await createResponsePromise;
      if (!createResponse.ok()) {
        throw new Error(
          `tasks.createがHTTP ${createResponse.status()}で失敗した`,
        );
      }
      await ctx.unrouteAll({ behavior: "wait" });

      const taskRow = page
        .locator('[data-testid="task-item"]')
        .filter({ hasText: taskTitle });
      await waitForPersistedTask(taskRow);
      await expect(taskRow).toBeVisible({ timeout: 5000 });
    } finally {
      await ctx.close();
      await cleanupTestList(browser, listName);
    }
  });

  test("タスク編集（completed化）が2秒遅延下でも500ms以内に打ち消し線が表示される", async ({
    browser,
  }) => {
    const listName = `楽観編集_${STAMP}`;
    const taskTitle = `編集対象_${STAMP}`;
    await setupTestList(browser, listName);

    const ctx = await browser.newContext(makeContextOptions());

    try {
      const page = await ctx.newPage();

      await Promise.all([
        page.goto("/"),
        page.waitForResponse((res) => res.url().includes("/api/trpc")),
      ]);

      await page.click(
        `[data-testid="list-select-btn"]:has-text("${listName}")`,
      );
      await page
        .locator('[data-testid="task-add-form"]')
        .waitFor({ timeout: 15000 });
      await addTask(page, taskTitle);

      const taskRow = page
        .locator('[data-testid="task-item"]')
        .filter({ hasText: taskTitle });
      await taskRow.waitFor({ timeout: 15000 });

      const checkbox = taskRow.locator('input[type="checkbox"]');

      await toggleTaskAndWaitForUpdate(page, checkbox);

      await ctx.route("**/api/trpc/**", async (route) => {
        const url = route.request().url();
        if (!url.includes("/api/trpc/tasks.update")) {
          await route.continue();
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        await route.continue();
      });

      const updateResponse = waitForTaskUpdateResponse(page);
      await checkbox.dispatchEvent("click");

      await expect(
        taskRow.locator('[data-testid="task-text"].line-through'),
      ).toBeVisible({ timeout: 500 });
      const response = await updateResponse;
      if (!response.ok()) {
        throw new Error(`tasks.updateがHTTP ${response.status()}で失敗した`);
      }

      await ctx.unroute("**/api/trpc/**");
    } finally {
      await ctx.close();
      await cleanupTestList(browser, listName);
    }
  });

  test("SSEブロック中に別コンテキストで追加したタスクが再接続後に反映される", async ({
    browser,
  }) => {
    const listName = `SSE再接続_${STAMP}`;
    const taskByCtxA = `コンテキストA_${STAMP}`;
    const taskByCtxB = `コンテキストB_${STAMP}`;
    await setupTestList(browser, listName);

    const ctxOptions = makeContextOptions();

    const ctxA = await browser.newContext(ctxOptions);
    const ctxB = await browser.newContext(ctxOptions);

    try {
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
      await addTask(pageA, taskByCtxA);
      const taskARow = pageA
        .locator('[data-testid="task-item"]')
        .filter({ hasText: taskByCtxA });
      await expect(taskARow).toBeVisible({ timeout: 15000 });
      await waitForPersistedTask(taskARow);

      await ctxA.setOffline(true);

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
      await addTask(pageB, taskByCtxB);
      const taskBRow = pageB
        .locator('[data-testid="task-item"]')
        .filter({ hasText: taskByCtxB });
      await expect(taskBRow).toBeVisible({ timeout: 15000 });
      await waitForPersistedTask(taskBRow);

      await ctxA.setOffline(false);

      await expect(
        pageA
          .locator('[data-testid="task-item"]')
          .filter({ hasText: taskByCtxB }),
      ).toBeVisible({ timeout: 15000 });
    } finally {
      await ctxB.close();
      await ctxA.close();
      await cleanupTestList(browser, listName);
    }
  });

  test("別コンテキストのリスト統合を全件同期する", async ({ browser }) => {
    const stamp = uniqueTestName("e2e");
    const sourceListName = `SSE統合元_${stamp}`;
    const targetListName = `SSE統合先_${stamp}`;
    const sourceTaskTitle = `SSE統合元タスク_${stamp}`;
    const targetTaskTitle = `SSE統合先タスク_${stamp}`;
    await setupTestLists(browser, [sourceListName, targetListName]);

    const ctxOptions = makeContextOptions();
    const ctxA = await browser.newContext(ctxOptions);
    const ctxB = await browser.newContext(ctxOptions);

    try {
      const pageA = await ctxA.newPage();
      await Promise.all([
        pageA.goto("/"),
        pageA.waitForResponse((response) =>
          response.url().includes("/api/trpc"),
        ),
      ]);
      const sourceListA = pageA
        .getByTestId("list-item")
        .filter({ hasText: sourceListName });
      const targetListA = pageA
        .getByTestId("list-item")
        .filter({ hasText: targetListName });
      await sourceListA.getByTestId("list-select-btn").click();
      await addTask(pageA, sourceTaskTitle);
      await targetListA.getByTestId("list-select-btn").click();
      await addTask(pageA, targetTaskTitle);

      const activeTaskRequests: Request[] = [];
      pageA.on("request", (request) => {
        if (isTrpcUrl(request.url(), "tasks.listActive")) {
          activeTaskRequests.push(request);
        }
      });

      const pageB = await ctxB.newPage();
      await Promise.all([
        pageB.goto("/"),
        pageB.waitForResponse((response) =>
          response.url().includes("/api/trpc"),
        ),
      ]);
      const sourceListB = pageB
        .getByTestId("list-item")
        .filter({ hasText: sourceListName });
      await sourceListB.getByTestId("list-menu-btn").click();
      await pageB.getByRole("menuitem", { name: "他のリストに統合" }).click();
      const mergeDialog = pageB.getByRole("dialog", {
        name: "リストの統合",
      });
      await mergeDialog.getByLabel("統合先リスト").selectOption({
        label: targetListName,
      });
      const mergeResponsePromise = waitForSuccessfulMutationResponse(
        pageB,
        "lists.merge",
      );
      await mergeDialog.getByRole("button", { name: "統合" }).click();
      await mergeResponsePromise;

      await expect(sourceListA).toHaveCount(0, { timeout: 15000 });
      await targetListA.getByTestId("list-select-btn").click();
      await expect(
        pageA.getByTestId("task-item").filter({ hasText: sourceTaskTitle }),
      ).toBeVisible({ timeout: 15000 });
      await expect(
        pageA.getByTestId("task-item").filter({ hasText: targetTaskTitle }),
      ).toBeVisible({ timeout: 15000 });
      expect(activeTaskRequests.length).toBeGreaterThan(0);
      const requestedFullSync = activeTaskRequests.some((request) => {
        const url = new URL(request.url());
        const rawInput = url.searchParams.get("input") ?? request.postData();
        if (!rawInput) throw new Error("tasks.listActive の入力がありません");
        const payload = JSON.parse(rawInput) as Record<string, unknown>;
        const procedures = url.pathname.slice("/api/trpc/".length).split(",");
        return procedures.some((procedure, index) => {
          if (procedure !== "tasks.listActive") return false;
          const input =
            url.searchParams.get("batch") === "1"
              ? payload[String(index)]
              : payload;
          return (
            input !== null &&
            typeof input === "object" &&
            !Array.isArray(input) &&
            !("since" in input)
          );
        });
      });
      expect(requestedFullSync).toBe(true);
    } finally {
      await ctxB.close();
      await ctxA.close();
      await cleanupTestLists(browser, [sourceListName, targetListName]);
    }
  });
});
