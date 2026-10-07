import { test, expect } from "@playwright/test";
import { waitForSuccessfulMutationResponse } from "./helpers/common";
import {
  addItem,
  openCaloriesAsNewUser,
  confirmedDay,
  bulkCreate,
  addRecordNow,
} from "./helpers/calorie-page";
test.describe("calories achievement", () => {
  test("目標内の日が続くと達成状況を表示する", async ({ browser }) => {
    const { context, page } = await openCaloriesAsNewUser(browser);
    try {
      await addItem(page, "目標内", "1000");
      await bulkCreate(page, "目標内", 8, 1);

      // 8日前が最初の記録の日なので、昨日と一昨日の2日が判定され、いずれも平均1000kcal
      const block = page.getByTestId("calorie-achievement");
      await expect(block).toHaveAttribute("data-achieved", "true");
      await expect(page.getByTestId("calorie-achievement-streak")).toHaveText(
        "2日連続で目標内",
      );
      const days = page.getByTestId("calorie-achievement-day");
      await expect(days).toHaveCount(28);
      await expect(days.nth(0)).toHaveAttribute("data-status", "achieved");
      await expect(days.nth(0)).toHaveAttribute(
        "aria-label",
        new RegExp(`^${confirmedDay(1).replaceAll("-", "/")}`),
      );
      await expect(days.nth(1)).toHaveAttribute("data-status", "achieved");
      await expect(days.nth(2)).toHaveAttribute("data-status", "unrated");

      await page.setViewportSize({ width: 320, height: 800 });
      const order = page.getByTestId("calorie-achievement-order");
      await expect(order).toContainText("昨日 → 28日前（横にスクロール）");
      await expect(order).toBeInViewport();
      await expect
        .poll(() =>
          page
            .getByRole("main")
            .evaluate((element) =>
              Math.ceil(element.getBoundingClientRect().width),
            ),
        )
        .toBeLessThanOrEqual(320);
      const dayList = page.getByRole("list", {
        name: "直近28日の達成状況",
      });
      await expect
        .poll(() =>
          days.evaluateAll(
            (elements) =>
              new Set(
                elements.map((element) =>
                  Math.round(element.getBoundingClientRect().top),
                ),
              ).size,
          ),
        )
        .toBe(1);
      expect(
        await dayList.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
      ).toBe(true);
      await dayList.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      await expect
        .poll(() => dayList.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
      await expect(days.nth(27)).toBeInViewport();
    } finally {
      await context.close();
    }
  });

  test("目標超過が続くと達成表示をしない", async ({ browser }) => {
    const { context, page } = await openCaloriesAsNewUser(browser);
    try {
      await addItem(page, "超過", "2000");
      await bulkCreate(page, "超過", 8, 1);

      await expect(
        page.getByTestId("calorie-achievement-day").nth(1),
      ).toHaveAttribute("data-status", "missed");
      await expect(page.getByTestId("calorie-achievement")).toHaveAttribute(
        "data-achieved",
        "false",
      );
      await expect(
        page.getByTestId("calorie-achievement-streak"),
      ).not.toBeAttached();
      await expect(
        page.getByTestId("calorie-achievement-day").nth(0),
      ).toHaveAttribute("data-status", "missed");
    } finally {
      await context.close();
    }
  });

  test("今日の摂取可能量が記録と目標変更に追随する", async ({ browser }) => {
    const { context, page } = await openCaloriesAsNewUser(browser);
    try {
      const remaining = page.getByTestId("calorie-achievement-remaining");
      await expect(remaining).toHaveText("あと 1,615 kcal");
      await addItem(page, "前の週", "1500");
      await addItem(page, "直近の週", "1000");
      await bulkCreate(page, "前の週", 14, 8);
      await bulkCreate(page, "直近の週", 7, 1);

      // 過去の記録は今日の残量に影響しない
      await expect(remaining).toHaveText("あと 1,615 kcal");
      await expect(page.getByText(/先週より/)).toHaveCount(0);
      await expect(
        page.getByText("翌朝4時まで・7日平均の目標に基づく"),
      ).toHaveCount(0);
      await page.locator("#calorie-record-quantity").fill("2");
      await addRecordNow(page, "直近の週");
      await expect(remaining).toHaveText("あと -385 kcal");

      await page.locator("#calorie-goal").fill("1000");
      const goalResponse = waitForSuccessfulMutationResponse(
        page,
        "users.updatePreferences",
      );
      await page
        .locator("#calorie-goal")
        .locator("..")
        .getByRole("button", { name: "保存" })
        .click();
      await goalResponse;
      await expect(remaining).toHaveText("あと -1,000 kcal");
      await page.reload();
      await expect(remaining).toHaveText("あと -1,000 kcal");

      // 目標を2500へ上げた後、残り500を一時項目で記録するとちょうど0になる
      await page.locator("#calorie-goal").fill("2500");
      const secondGoalResponse = waitForSuccessfulMutationResponse(
        page,
        "users.updatePreferences",
      );
      await page
        .locator("#calorie-goal")
        .locator("..")
        .getByRole("button", { name: "保存" })
        .click();
      await secondGoalResponse;
      await expect(remaining).toHaveText("あと 500 kcal");
      await page.locator("#calorie-record-quantity").fill("500");
      await addRecordNow(page, "一時の食事");
      await expect(remaining).toHaveText("あと 0 kcal");
      await page.setViewportSize({ width: 320, height: 800 });
      await expect(remaining).toBeInViewport();
    } finally {
      await context.close();
    }
  });

  test("残量リングが目標比を示す", async ({ browser }) => {
    const { context, page } = await openCaloriesAsNewUser(browser);
    try {
      await addItem(page, "少なめ", "800");
      await addItem(page, "多め", "1000");
      const arc = page.getByTestId("calorie-summary-ring-arc");

      // 初期目標1615kcalに対し、直後の摂取800kcalはおよそ49.5%
      await addRecordNow(page, "少なめ");
      await expect(arc).toHaveAttribute("stroke-dasharray", /^49\.\d 100$/);

      // 合計1800kcalで目標を超えると全周になる
      await addRecordNow(page, "多め");
      await expect(arc).toHaveAttribute("stroke-dasharray", "100 100");
      await expect(
        page.getByTestId("calorie-summary-ring"),
      ).toHaveAccessibleName(/^目標に対して11\d\.\d%$/);
    } finally {
      await context.close();
    }
  });
});
