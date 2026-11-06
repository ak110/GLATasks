import { test, expect, type Page } from "@playwright/test";

// 旧通知の自然消滅を検収結果にしないため、検証中に自動消去されない長さを使う。
const timerFailure = `タイマー取得失敗。${"接続状態を確認してから再試行してください。".repeat(8)}`;
const searchFailure = `検索取得失敗。${"接続状態を確認してから再試行してください。".repeat(8)}`;
const scheduleFailure = `スケジュール取得失敗。${"接続状態を確認してから再試行してください。".repeat(8)}`;

async function routeFailures(page: Page, failures: Set<string>) {
  await page.route("**/healthcheck", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    }),
  );
  await page.route("**/api/events", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: ": test\n\n",
    }),
  );
  await page.route("**/api/trpc/**", async (route) => {
    const request = route.request();
    const responses = new URL(request.url()).pathname
      .split("/")
      .at(-1)!
      .split(",")
      .map((procedure) => {
        if (request.method() !== "GET" || failures.has(procedure))
          return {
            error: {
              message:
                request.method() !== "GET"
                  ? "保存失敗"
                  : procedure === "timers.list"
                    ? timerFailure
                    : procedure === "tasks.search"
                      ? searchFailure
                      : procedure === "schedules.list"
                        ? scheduleFailure
                        : "リスト取得失敗",
              code: -32603,
              data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
            },
          };
        const data =
          procedure === "timers.list"
            ? { timers: [], serverTime: new Date().toISOString() }
            : procedure === "users.getPreferences"
              ? {}
              : procedure === "lists.list"
                ? [
                    {
                      id: 91001,
                      title: "通知確認リスト",
                      sortOrder: 1,
                      status: "active",
                      todoCount: 0,
                      lastUpdated: new Date().toISOString(),
                    },
                  ]
                : procedure === "tasks.listActive"
                  ? {
                      mode: "full",
                      tasks: [],
                      serverTime: new Date().toISOString(),
                    }
                  : [];
        return { result: { data } };
      });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responses),
    });
  });
}

test("Query通知: cached dataの再取得失敗を通知する", async ({ page }) => {
  await page.clock.install();
  const failures = new Set<string>();
  await routeFailures(page, failures);
  await page.goto("/");
  const list = page
    .getByTestId("list-item")
    .filter({ hasText: "通知確認リスト" });
  await expect(list).toBeVisible();
  await page.getByRole("link", { name: "タイマー", exact: true }).click();
  await expect(page.getByTestId("timer-add-btn")).toBeVisible();
  await page.clock.fastForward(5 * 60 * 1000 + 1);
  failures.add("lists.list");
  await page.getByRole("link", { name: "タスク", exact: true }).click();
  await expect(list).toBeVisible();
  await expect(page.getByTestId("toast-error")).toContainText("リスト取得失敗");
});

test("Query通知: hashなし320px検索は他Queryの可視inlineで抑止しない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const failures = new Set(["lists.list", "tasks.search"]);
  await routeFailures(page, failures);
  await page.goto("/");
  await expect(
    page.getByRole("alert").filter({ hasText: "リストを取得できませんでした" }),
  ).toBeVisible();
  await expect(page.getByTestId("toast-error")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await page.getByTestId("search-input").fill('未表示"[検索]');
  await expect(page.locator("main")).not.toBeVisible();
  await expect(page.getByTestId("toast-error")).toContainText("検索取得失敗");
  failures.delete("lists.list");
  await page
    .getByRole("alert")
    .filter({ hasText: "リストを取得できませんでした" })
    .getByRole("button", { name: "再試行" })
    .click();
  await page.getByTestId("list-select-btn").first().click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("toast-error")).toHaveCount(0);
});

test("Query通知: viewportだけの切替でも可視inlineへ通知を集約する", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await routeFailures(page, new Set(["tasks.search"]));
  await page.goto("/");
  await expect(page.getByTestId("list-item")).toBeVisible();
  await page.getByTestId("search-input").fill("表示幅の切替");
  await expect(page.getByTestId("toast-error")).toContainText("検索取得失敗");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("toast-error")).toHaveCount(0);
});

test("Query通知: ScheduleDialog再表示は既存observerの切替で旧通知を回収する", async ({
  page,
}) => {
  const gate = Promise.withResolvers<void>();
  const intercepted = Promise.withResolvers<void>();
  await routeFailures(page, new Set(["schedules.list"]));
  await page.route("**/api/trpc/**", async (route) => {
    if (new URL(route.request().url()).pathname.includes("schedules.list")) {
      intercepted.resolve();
      await gate.promise;
    }
    await route.fallback();
  });
  try {
    await page.goto("/");
    await page.getByTestId("list-menu-btn").first().click();
    await page.getByTestId("list-schedules-btn").click();
    await intercepted.promise;
    const dialog = page.getByRole("dialog", { name: "定期TODO", exact: true });
    await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
    gate.resolve();
    const toast = page
      .getByTestId("toast-error")
      .filter({ hasText: "スケジュール取得失敗" });
    await expect(toast).toBeVisible();
    await page.getByTestId("list-menu-btn").first().click();
    await page.getByTestId("list-schedules-btn").click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(toast).toHaveCount(0);
  } finally {
    gate.resolve();
  }
});

test("Query通知: ScheduleDialogのeditorだけを閉じても可視inlineへ通知を集約する", async ({
  page,
}) => {
  const gate = Promise.withResolvers<void>();
  const intercepted = Promise.withResolvers<void>();
  await routeFailures(page, new Set(["schedules.list"]));
  await page.route("**/api/trpc/**", async (route) => {
    if (new URL(route.request().url()).pathname.includes("schedules.list")) {
      intercepted.resolve();
      await gate.promise;
    }
    await route.fallback();
  });
  try {
    await page.goto("/");
    await page.getByTestId("list-menu-btn").first().click();
    await page.getByTestId("list-schedules-btn").click();
    await intercepted.promise;
    const dialog = page.getByRole("dialog", { name: "定期TODO", exact: true });
    await dialog.getByTestId("schedule-add-btn").click();
    await expect(dialog.getByTestId("schedule-title-input")).toBeVisible();
    gate.resolve();
    const toast = page
      .getByTestId("toast-error")
      .filter({ hasText: "スケジュール取得失敗" });
    await expect(toast).toBeVisible();
    await dialog
      .getByRole("button", { name: "キャンセル", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(toast).toHaveCount(0);
  } finally {
    gate.resolve();
  }
});

test("Query通知: 画面外timerの旧toastを到達と復旧で回収しmutationは残す", async ({
  page,
}) => {
  const failures = new Set(["timers.list"]);
  await routeFailures(page, failures);
  await page.goto("/");
  const timerToast = page
    .getByTestId("toast-error")
    .filter({ hasText: "タイマー取得失敗" });
  await expect(timerToast).toBeVisible();
  await page.getByPlaceholder("新しいリスト").fill("通知確認");
  await page.getByPlaceholder("新しいリスト").press("Enter");
  const mutationToast = page
    .getByTestId("toast-error")
    .filter({ hasText: "保存失敗" });
  await expect(mutationToast).toBeVisible();
  await page.getByRole("link", { name: "タイマー", exact: true }).click();
  const retry = page.getByRole("button", { name: "再試行" });
  await expect(retry).toBeVisible();
  await expect(timerToast).toHaveCount(0);
  await expect(mutationToast).toBeVisible();
  failures.clear();
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(timerToast).toHaveCount(0);
  await expect(mutationToast).toBeVisible();
});

test("Query通知は画面内の復旧と現在pathを尊重し、未指定Queryとmutationの通知を保つ", async ({
  page,
}) => {
  await page.clock.install();
  const failures = new Set(["timers.list"]);
  let healthchecks = 0;
  await page.route("**/healthcheck", async (route) => {
    healthchecks++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    });
  });
  await page.route("**/api/events", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: ": test\n\n",
    }),
  );
  await page.route("**/api/trpc/**", async (route) => {
    const request = route.request();
    const procedures = new URL(request.url()).pathname
      .split("/")
      .at(-1)!
      .split(",");
    const responses = procedures.map((procedure) => {
      if (request.method() !== "GET" || failures.has(procedure))
        return {
          error: {
            message:
              request.method() !== "GET"
                ? "保存失敗"
                : procedure === "users.getPreferences"
                  ? "設定取得失敗"
                  : "タイマー取得失敗",
            code: -32603,
            data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
          },
        };
      const data =
        procedure === "timers.list"
          ? { timers: [], serverTime: new Date().toISOString() }
          : procedure === "users.getPreferences"
            ? {}
            : procedure === "tasks.listActive"
              ? {
                  mode: "full",
                  tasks: [],
                  serverTime: new Date().toISOString(),
                }
              : [];
      return { result: { data } };
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responses),
    });
  });
  await page.goto("/timers");
  const inline = page
    .getByRole("alert")
    .filter({ hasText: "タイマーを取得できませんでした" });
  await expect(inline).toBeVisible();
  await expect(inline.getByRole("button", { name: "再試行" })).toBeEnabled();
  await expect(page.getByTestId("toast-error")).toHaveCount(0);
  failures.clear();
  await inline.getByRole("button", { name: "再試行" }).click();
  await expect(inline).toHaveCount(0);
  await expect(page.getByTestId("toast-error")).toHaveCount(0);

  await page.getByRole("link", { name: "タスク", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  failures.add("timers.list");
  const fetched = page.waitForResponse((response) =>
    response.url().includes("timers.list"),
  );
  await page.clock.fastForward(60_001);
  await fetched;
  await expect(page.getByTestId("toast-error")).toContainText(
    "タイマー取得失敗",
  );
  expect(healthchecks).toBeGreaterThan(0);
  await page.getByTestId("toast-error").getByRole("button").click();
  failures.clear();
  failures.add("users.getPreferences");
  await page.goto("/timers");
  await expect(page.getByTestId("toast-error")).toContainText("設定取得失敗");
  await page.getByTestId("toast-error").getByRole("button").click();
  await page.getByTestId("timer-add-btn").click();
  await page.getByTestId("timer-name-input").fill("通知検証用");
  await page.getByTestId("timer-submit-btn").click();
  await expect(page.getByTestId("toast-error")).toContainText("保存失敗");
});
