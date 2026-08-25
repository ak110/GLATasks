/**
 * @fileoverview モバイル相当の viewport におけるタスクD&Dのe2eテスト
 */

import { test, expect, type Page, type Request } from "@playwright/test";
import {
  cleanupTestLists,
  setupTestLists,
  waitForPersistedTask,
} from "./helpers/common";

const stamp = Date.now();
const sourceListName = `タッチ移動元_${stamp}`;
const targetListName = `タッチ移動先_${stamp}`;

async function dispatchPointerEvent(
  page: Page,
  type: "pointermove" | "pointerup" | "pointercancel",
  pointerId: number,
  clientX: number,
  clientY: number,
): Promise<void> {
  await page.evaluate(
    ({ type, pointerId, clientX, clientY }) => {
      window.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId,
          pointerType: "touch",
          clientX,
          clientY,
        }),
      );
    },
    { type, pointerId, clientX, clientY },
  );
}

test.describe("dnd task move (mobile viewport)", () => {
  test.beforeAll(async ({ browser }) => {
    await setupTestLists(browser, [sourceListName, targetListName]);
  });

  test.afterAll(async ({ browser }) => {
    await cleanupTestLists(browser, [sourceListName, targetListName]);
  });

  test("タッチ操作でタスクを別リストへ移動できる", async ({ page }) => {
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
    await page
      .getByTestId("list-select-btn")
      .filter({ hasText: sourceListName })
      .click();
    await page.getByTestId("task-add-form").waitFor({ timeout: 15000 });

    const taskTitle = `タッチ別リスト移動_${Date.now()}`;
    const form = page.getByTestId("task-add-form");
    await form.locator("textarea").fill(taskTitle);
    const createResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/trpc/tasks.create"),
    );
    await form.locator('button[type="submit"]').click();
    const createResponse = await createResponsePromise;
    expect(createResponse.ok()).toBe(true);

    const taskRow = page
      .getByTestId("task-item")
      .filter({ hasText: taskTitle });
    await expect(taskRow).toBeVisible({ timeout: 15000 });
    await waitForPersistedTask(taskRow);

    const targetList = page
      .getByTestId("list-item")
      .filter({ hasText: targetListName });
    await expect(targetList).not.toBeVisible();

    let updateRequestCount = 0;
    const onRequest = (request: Request) => {
      if (request.url().includes("/api/trpc/tasks.update")) {
        updateRequestCount += 1;
      }
    };
    page.on("request", onRequest);
    try {
      const handle = taskRow.getByTestId("task-drag-handle");
      const handleBox = await handle.boundingBox();
      if (!handleBox)
        throw new Error("タッチ操作対象の境界ボックスを取得できない");
      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;

      await handle.dispatchEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        pointerType: "touch",
        clientX: startX,
        clientY: startY,
      });
      await dispatchPointerEvent(
        page,
        "pointermove",
        1,
        startX + 20,
        startY + 20,
      );
      await expect(targetList).toBeVisible({ timeout: 5000 });

      await dispatchPointerEvent(
        page,
        "pointercancel",
        1,
        startX + 20,
        startY + 20,
      );
      await expect(targetList).not.toBeVisible({ timeout: 5000 });
      await expect(page.getByTestId("task-add-form")).toBeVisible();
      expect(updateRequestCount).toBe(0);

      const secondHandleBox = await handle.boundingBox();
      if (!secondHandleBox) {
        throw new Error("再試行するタッチ操作対象の境界ボックスを取得できない");
      }
      const secondStartX = secondHandleBox.x + secondHandleBox.width / 2;
      const secondStartY = secondHandleBox.y + secondHandleBox.height / 2;
      await handle.dispatchEvent("pointerdown", {
        bubbles: true,
        pointerId: 2,
        pointerType: "touch",
        clientX: secondStartX,
        clientY: secondStartY,
      });
      await dispatchPointerEvent(
        page,
        "pointermove",
        2,
        secondStartX + 20,
        secondStartY + 20,
      );
      await expect(targetList).toBeVisible({ timeout: 5000 });

      const targetButton = targetList.getByTestId("list-select-btn");
      await targetButton.scrollIntoViewIfNeeded();
      const targetBox = await targetButton.boundingBox();
      if (!targetBox) {
        throw new Error("タッチ操作の移動先境界ボックスを取得できない");
      }
      const updateResponsePromise = page.waitForResponse((response) =>
        response.url().includes("/api/trpc/tasks.update"),
      );
      await dispatchPointerEvent(
        page,
        "pointermove",
        2,
        targetBox.x + targetBox.width / 2,
        targetBox.y + targetBox.height / 2,
      );
      await dispatchPointerEvent(
        page,
        "pointerup",
        2,
        targetBox.x + targetBox.width / 2,
        targetBox.y + targetBox.height / 2,
      );
      const updateResponse = await updateResponsePromise;
      expect(updateResponse.ok()).toBe(true);
      await expect(taskRow).toHaveCount(0, { timeout: 15000 });

      await page
        .getByRole("button", { name: "リスト一覧に戻る", exact: true })
        .click();
      await expect(targetButton).toBeVisible({ timeout: 5000 });
      await targetButton.click();
      await expect(page.getByTestId("task-item").first()).toContainText(
        taskTitle,
        { timeout: 15000 },
      );
    } finally {
      page.off("request", onRequest);
    }
  });
});
