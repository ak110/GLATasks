import {
  cleanupTestList,
  isTrpcUrl,
  setupTestList,
  uniqueTestName,
  waitForMutationResponse,
} from "./helpers/common";
import { openCalories, openCaloriesAsNewUser } from "./helpers/calorie-page";
import { test, expect, type Page } from "@playwright/test";

const RETRY_INTERVAL_MS = 3_000;

const LIST_NAME = `自動再読み込み_${uniqueTestName("e2e")}`;

test.beforeAll(async ({ browser }) => {
  await setupTestList(browser, LIST_NAME);
});

test.afterAll(async ({ browser }) => {
  await cleanupTestList(browser, LIST_NAME);
});

async function routeNewVersion(page: Page) {
  const newVersion = "e2e-auto-reload-new-version";
  let reportNewVersion = false;
  await page.route("**/__data.json*", async (route) => {
    if (!reportNewVersion) return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "x-sveltekit-version": newVersion },
    });
  });
  return {
    async detect() {
      reportNewVersion = true;
      await Promise.all([
        page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname.endsWith("/__data.json") &&
            response.headers()["x-sveltekit-version"] === newVersion,
        ),
        page.getByTestId("header-nav-timers").hover(),
      ]);
    },
    reset() {
      reportNewVersion = false;
    },
  };
}

async function placeReloadMarker(page: Page) {
  const marker = `update-marker-${uniqueTestName("e2e")}`;
  await page.evaluate((value) => {
    (window as typeof window & { __updateMarker?: string }).__updateMarker =
      value;
  }, marker);
  return marker;
}

function readReloadMarker(page: Page) {
  return page.evaluate(
    () =>
      (window as typeof window & { __updateMarker?: string }).__updateMarker,
  );
}

async function openTasks(page: Page) {
  await Promise.all([
    page.goto("/"),
    page.waitForResponse((res) => res.url().includes("/api/trpc")),
  ]);
}

test("作業中でなければ、新しい版の検知で自動的に再読み込みする", async ({
  page,
}) => {
  const version = await routeNewVersion(page);
  await openTasks(page);
  await placeReloadMarker(page);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName))
    .not.toMatch(/^(INPUT|TEXTAREA|SELECT)$/);

  const reloaded = page.waitForEvent("load");
  await version.detect();
  version.reset();
  await reloaded;

  await expect.poll(() => readReloadMarker(page)).toBeUndefined();
  await expect(page.getByTestId("update-banner")).toHaveCount(0);
});

test("タスク追加フォームに未保存の入力が残る間は、フォーカスが外れても再読み込みせず、入力を消すと再読み込みする", async ({
  page,
}) => {
  await page.clock.install();
  const version = await routeNewVersion(page);
  await openTasks(page);
  await page
    .getByTestId("list-select-btn")
    .filter({ hasText: LIST_NAME })
    .click();
  const textarea = page.getByTestId("task-add-form").locator("textarea");
  await expect(textarea).toBeVisible();
  const marker = await placeReloadMarker(page);

  const draft = `未保存の入力 ${uniqueTestName("e2e")}`;
  await textarea.fill(draft);
  await textarea.blur();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName))
    .not.toMatch(/^(INPUT|TEXTAREA|SELECT)$/);

  await version.detect();
  await expect(page.getByTestId("update-banner")).toBeVisible();
  await page.clock.runFor(RETRY_INTERVAL_MS * 2 + 1_000);
  expect(await readReloadMarker(page)).toBe(marker);
  await expect(textarea).toHaveValue(draft);

  await textarea.fill("");
  await textarea.blur();
  version.reset();
  const reloaded = page.waitForEvent("load");
  await page.clock.runFor(RETRY_INTERVAL_MS);
  await reloaded;
  await expect.poll(() => readReloadMarker(page)).toBeUndefined();
});

test("1日目標は保存に失敗した入力を残す間は再読み込みせず、保存に成功すると値が欄に残っていても再読み込みする", async ({
  browser,
}) => {
  const { context, page } = await openCaloriesAsNewUser(browser);
  try {
    await page.clock.install();
    const version = await routeNewVersion(page);
    await openCalories(page);
    const marker = await placeReloadMarker(page);

    const goal = page.locator("#calorie-goal");
    const saveButton = goal.locator("..").getByRole("button", { name: "保存" });
    const failSave = (url: URL) =>
      isTrpcUrl(url.toString(), "users.updatePreferences");
    await page.route(failSave, (route) => route.fulfill({ status: 500 }));

    await goal.fill("1234");
    const failed = waitForMutationResponse(page, "users.updatePreferences");
    await saveButton.click();
    expect((await failed).ok()).toBe(false);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName))
      .not.toMatch(/^(INPUT|TEXTAREA|SELECT)$/);
    await expect(
      page.locator('dialog[open], [role="dialog"][aria-modal="true"]'),
    ).toHaveCount(0);

    await version.detect();
    await expect(page.getByTestId("update-banner")).toBeVisible();
    await page.clock.runFor(RETRY_INTERVAL_MS * 2 + 1_000);
    expect(await readReloadMarker(page)).toBe(marker);
    await expect(goal).toHaveValue("1234");

    await page.unroute(failSave);
    const saved = waitForMutationResponse(page, "users.updatePreferences");
    await saveButton.click();
    expect((await saved).ok()).toBe(true);
    await expect(goal).toHaveAttribute("data-clean-value", "1234");
    version.reset();
    const reloaded = page.waitForEvent("load");
    await page.clock.runFor(RETRY_INTERVAL_MS);
    await reloaded;
    await expect.poll(() => readReloadMarker(page)).toBeUndefined();
    await expect(goal).toHaveValue("1234");
  } finally {
    await context.close();
  }
});
