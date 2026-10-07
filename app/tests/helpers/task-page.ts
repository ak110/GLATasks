import { isTrpcUrl } from "./common";
import { expect, type Page } from "@playwright/test";

export async function holdTaskCreate(
  page: Page,
  failureStatus?: number,
): Promise<{
  intercepted: Promise<void>;
  release: () => void;
}> {
  let notifyIntercepted!: () => void;
  let release!: () => void;
  const intercepted = new Promise<void>((resolve) => {
    notifyIntercepted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/trpc/**", async (route) => {
    if (!isTrpcUrl(route.request().url(), "tasks.create")) {
      await route.continue();
      return;
    }
    notifyIntercepted();
    await released;
    if (failureStatus === undefined) {
      await route.continue();
    } else {
      await route.fulfill({ status: failureStatus });
    }
  });

  return { intercepted, release };
}

export async function holdTaskReorder(page: Page): Promise<{
  intercepted: Promise<void>;
  release: () => void;
}> {
  let notifyIntercepted!: () => void;
  let release!: () => void;
  const intercepted = new Promise<void>((resolve) => {
    notifyIntercepted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/trpc/**", async (route) => {
    if (!isTrpcUrl(route.request().url(), "tasks.reorder")) {
      await route.continue();
      return;
    }
    notifyIntercepted();
    await released;
    await route.fulfill({ status: 500 });
  });

  return { intercepted, release };
}

export async function dragTaskAfter(
  page: Page,
  sourceTitle: string,
  targetTitle: string,
): Promise<void> {
  const reorderResponsePromise = page.waitForResponse((response) =>
    isTrpcUrl(response.url(), "tasks.reorder"),
  );
  await performTaskDragAfter(page, sourceTitle, targetTitle);
  const reorderResponse = await reorderResponsePromise;
  expect(reorderResponse.ok()).toBe(true);
}

export async function performTaskDragAfter(
  page: Page,
  sourceTitle: string,
  targetTitle: string,
): Promise<void> {
  const source = page.getByTestId("task-item").filter({ hasText: sourceTitle });
  const target = page.getByTestId("task-item").filter({ hasText: targetTitle });
  const handleBox = await source.getByTestId("task-drag-handle").boundingBox();
  const targetBox = await target.boundingBox();
  if (!handleBox || !targetBox) {
    throw new Error("並び替え対象の境界ボックスを取得できない");
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height - 5;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 20, startY + 20);
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
}
