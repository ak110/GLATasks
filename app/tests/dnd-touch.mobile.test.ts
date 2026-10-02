/**
 * @fileoverview モバイル相当の viewport におけるタスクD&Dのe2eテスト
 *
 * 2ペイン表示にならない幅では、D&Dをリスト内の並び替えに限定し、
 * ドラッグ中もリスト一覧へ切り替えず別リストへの移動を受け付けないことを検証する。
 */

import { test, expect, type Page, type Request } from "@playwright/test";
import {
  cleanupTestLists,
  setupTestLists,
  waitForPersistedTask,
} from "./helpers/common";

const stamp = Date.now();
const sourceListName = `タッチ並び替え元_${stamp}`;
const otherListName = `タッチ並び替え他_${stamp}`;
const longListName = `タッチ自動スクロール_${stamp}`;

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

async function addTask(page: Page, title: string): Promise<void> {
  const form = page.getByTestId("task-add-form");
  await form.locator("textarea").fill(title);
  const createResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/trpc/tasks.create"),
  );
  await form.locator('button[type="submit"]').click();
  const createResponse = await createResponsePromise;
  expect(createResponse.ok()).toBe(true);
  const taskRow = page.getByTestId("task-item").filter({ hasText: title });
  await expect(taskRow).toBeVisible({ timeout: 15000 });
  await waitForPersistedTask(taskRow);
}

async function taskTitlesInOrder(
  page: Page,
  titles: string[],
): Promise<string[]> {
  const texts = await page.getByTestId("task-item").allTextContents();
  return texts.flatMap((text) => titles.filter((t) => text.includes(t)));
}

test.describe("dnd task reorder (mobile viewport)", () => {
  test.beforeAll(async ({ browser }) => {
    await setupTestLists(browser, [
      sourceListName,
      otherListName,
      longListName,
    ]);
  });

  test.afterAll(async ({ browser }) => {
    await cleanupTestLists(browser, [
      sourceListName,
      otherListName,
      longListName,
    ]);
  });

  test("タッチ操作のD&Dはリスト内の並び替えだけを行い、リスト一覧へ切り替えない", async ({
    page,
  }) => {
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
    await page
      .getByTestId("list-select-btn")
      .filter({ hasText: sourceListName })
      .click();
    await page.getByTestId("task-add-form").waitFor({ timeout: 15000 });

    const firstTitle = `タッチ並び替えA_${Date.now()}`;
    const secondTitle = `タッチ並び替えB_${Date.now()}`;
    await addTask(page, firstTitle);
    await addTask(page, secondTitle);
    const titles = [firstTitle, secondTitle];
    const initialOrder = await taskTitlesInOrder(page, titles);
    expect(initialOrder).toHaveLength(2);

    const otherList = page
      .getByTestId("list-item")
      .filter({ hasText: otherListName });
    await expect(otherList).not.toBeVisible();

    let updateRequestCount = 0;
    const onRequest = (request: Request) => {
      if (request.url().includes("/api/trpc/tasks.update")) {
        updateRequestCount += 1;
      }
    };
    page.on("request", onRequest);
    try {
      const sourceRow = page
        .getByTestId("task-item")
        .filter({ hasText: initialOrder[0] });
      const targetRow = page
        .getByTestId("task-item")
        .filter({ hasText: initialOrder[1] });
      const handle = sourceRow.getByTestId("task-drag-handle");
      const handleBox = await handle.boundingBox();
      const targetBox = await targetRow.boundingBox();
      if (!handleBox || !targetBox) {
        throw new Error("タッチ操作対象の境界ボックスを取得できない");
      }
      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;

      await handle.dispatchEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        pointerType: "touch",
        clientX: startX,
        clientY: startY,
      });
      await dispatchPointerEvent(page, "pointermove", 1, startX, startY + 20);

      // ドラッグ中もタスク一覧を表示したままとし、リスト一覧へ切り替えない
      await expect(page.getByTestId("task-add-form")).toBeVisible();
      await expect(otherList).not.toBeVisible();

      const dropX = targetBox.x + targetBox.width / 2;
      const dropY = targetBox.y + targetBox.height * 0.75;
      const reorderResponsePromise = page.waitForResponse((response) =>
        response.url().includes("/api/trpc/tasks.reorder"),
      );
      await dispatchPointerEvent(page, "pointermove", 1, dropX, dropY);
      await dispatchPointerEvent(page, "pointerup", 1, dropX, dropY);
      const reorderResponse = await reorderResponsePromise;
      expect(reorderResponse.ok()).toBe(true);

      await expect
        .poll(() => taskTitlesInOrder(page, titles), { timeout: 15000 })
        .toEqual([initialOrder[1], initialOrder[0]]);
      await expect(otherList).not.toBeVisible();
      expect(updateRequestCount).toBe(0);
    } finally {
      page.off("request", onRequest);
    }
  });

  test("表示範囲を超える一覧でも、端付近で保持すると自動スクロールして末尾・先頭へ移せる", async ({
    page,
  }) => {
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
    await page
      .getByTestId("list-select-btn")
      .filter({ hasText: longListName })
      .click();
    await page.getByTestId("task-add-form").waitFor({ timeout: 15000 });

    const titles: string[] = [];
    for (let i = 0; i < 14; i++) {
      const title = `自動スクロール${String(i).padStart(2, "0")}_${Date.now()}`;
      titles.push(title);
      await addTask(page, title);
    }
    const scrollArea = page.getByTestId("task-list-scroll");
    const initialOrder = await taskTitlesInOrder(page, titles);
    expect(initialOrder).toHaveLength(titles.length);
    // 表示範囲を超えていることを前提条件として確認する
    expect(
      await scrollArea.evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);

    /**
     * 指定タスクのハンドルを掴み、スクロール領域の端付近で保持して自動スクロールさせ、
     * 端まで達した後に端のタスクの外側半分でドロップする。
     */
    async function dragToEdge(
      title: string,
      edge: "bottom" | "top",
      pointerId: number,
    ): Promise<void> {
      const row = page.getByTestId("task-item").filter({ hasText: title });
      await row.scrollIntoViewIfNeeded();
      const handle = row.getByTestId("task-drag-handle");
      const handleBox = await handle.boundingBox();
      const areaBox = await scrollArea.boundingBox();
      if (!handleBox || !areaBox) {
        throw new Error("タッチ操作対象の境界ボックスを取得できない");
      }
      const x = handleBox.x + handleBox.width / 2;
      await handle.dispatchEvent("pointerdown", {
        bubbles: true,
        pointerId,
        pointerType: "touch",
        clientX: x,
        clientY: handleBox.y + handleBox.height / 2,
      });
      const holdY =
        edge === "bottom" ? areaBox.y + areaBox.height - 8 : areaBox.y + 8;
      await dispatchPointerEvent(page, "pointermove", pointerId, x, holdY);

      // 指を止めたまま端までスクロールするのを待つ
      await expect
        .poll(
          () =>
            scrollArea.evaluate(
              (el, dir) =>
                dir === "bottom"
                  ? el.scrollTop + el.clientHeight >= el.scrollHeight - 1
                  : el.scrollTop <= 0,
              edge,
            ),
          { timeout: 15000 },
        )
        .toBe(true);

      const order = await taskTitlesInOrder(page, titles);
      const edgeTitle = edge === "bottom" ? order[order.length - 1] : order[0];
      const edgeBox = await page
        .getByTestId("task-item")
        .filter({ hasText: edgeTitle })
        .boundingBox();
      if (!edgeBox) throw new Error("端のタスクの境界ボックスを取得できない");
      const dropY =
        edge === "bottom"
          ? edgeBox.y + edgeBox.height * 0.75
          : edgeBox.y + edgeBox.height * 0.25;
      const reorderResponsePromise = page.waitForResponse((response) =>
        response.url().includes("/api/trpc/tasks.reorder"),
      );
      await dispatchPointerEvent(page, "pointermove", pointerId, x, dropY);
      await dispatchPointerEvent(page, "pointerup", pointerId, x, dropY);
      const reorderResponse = await reorderResponsePromise;
      expect(reorderResponse.ok()).toBe(true);
    }

    const first = initialOrder[0];
    await dragToEdge(first, "bottom", 11);
    await expect
      .poll(() => taskTitlesInOrder(page, titles), { timeout: 15000 })
      .toEqual([...initialOrder.slice(1), first]);

    await dragToEdge(first, "top", 12);
    await expect
      .poll(() => taskTitlesInOrder(page, titles), { timeout: 15000 })
      .toEqual(initialOrder);
  });
});
