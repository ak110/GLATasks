import { test, expect } from "@playwright/test";

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
