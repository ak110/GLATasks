/**
 * @fileoverview 検索表示種別と選択中リスト優先表示のe2eテスト
 */

import { test, expect, type Page } from "@playwright/test";
import {
  cleanupTestList,
  setupTestList,
  toggleTaskAndWaitForUpdate,
} from "./helpers/common";

const STAMP = Date.now();

async function selectList(page: Page, listName: string): Promise<void> {
  await page
    .getByTestId("list-select-btn")
    .filter({ hasText: listName })
    .click();
  await page.getByTestId("task-add-form").waitFor({ timeout: 15000 });
}

async function addTask(page: Page, title: string): Promise<void> {
  const form = page.getByTestId("task-add-form");
  await form.locator("textarea").fill(title);
  await form.locator('button[type="submit"]').click();
  await expect(
    page.getByTestId("task-item").filter({ hasText: title }),
  ).toBeVisible({
    timeout: 15000,
  });
}

async function archiveMatchingTasks(page: Page, title: string): Promise<void> {
  const row = page.getByTestId("task-item").filter({ hasText: title });
  const checkbox = row.getByRole("checkbox");
  await toggleTaskAndWaitForUpdate(page, checkbox);
  await toggleTaskAndWaitForUpdate(page, checkbox);
  await expect(checkbox).toBeChecked();
  await Promise.all([
    page.getByTitle("完了済みタスクを非表示にする").click(),
    page.waitForResponse((response) =>
      response.url().includes("/api/trpc/lists.clear"),
    ),
  ]);
  await expect(row).toHaveCount(0, { timeout: 15000 });
}

test("検索の表示種別と選択リスト優先表示が反映される", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);

  const activeListName = `検索アクティブ_${STAMP}`;
  const archivedListName = `検索アーカイブ_${STAMP}`;
  const keyword = `検索分類_${STAMP}`;
  const activeTask = `${keyword}_A1`;
  const activeArchivedTask = `${keyword}_A2`;
  const archivedTask = `${keyword}_B1`;
  const archivedArchivedTask = `${keyword}_B2`;

  await setupTestList(browser, activeListName);
  await setupTestList(browser, archivedListName);
  let archivedList = false;

  try {
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((response) => response.url().includes("/api/trpc")),
    ]);
    await selectList(page, activeListName);
    await addTask(page, activeTask);
    await addTask(page, activeArchivedTask);
    await archiveMatchingTasks(page, activeArchivedTask);

    await selectList(page, archivedListName);
    await addTask(page, archivedTask);
    await addTask(page, archivedArchivedTask);
    await archiveMatchingTasks(page, archivedArchivedTask);

    const archivedRow = page
      .getByTestId("list-item")
      .filter({ hasText: archivedListName });
    await archivedRow.getByTestId("list-menu-btn").click();
    await archivedRow.getByText("アーカイブ", { exact: true }).click();
    await Promise.all([
      page
        .getByRole("dialog")
        .last()
        .getByRole("button", { name: "アーカイブ", exact: true })
        .click(),
      page.waitForResponse((response) =>
        response.url().includes("/api/trpc/lists.archive"),
      ),
    ]);
    archivedList = true;

    await selectList(page, activeListName);
    const searchInput = page.getByTestId("search-input");
    const showType = page.locator("header select");
    await searchInput.fill(keyword);

    await expect(
      page.getByRole("button", { name: activeTask, exact: true }),
    ).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("button", { name: activeArchivedTask, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: archivedTask, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: archivedArchivedTask, exact: true }),
    ).toHaveCount(0);

    await showType.selectOption("archived");
    await expect(
      page.getByRole("button", { name: activeArchivedTask, exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: archivedArchivedTask, exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: activeTask, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: archivedTask, exact: true }),
    ).toHaveCount(0);

    await showType.selectOption("all");
    for (const title of [
      activeTask,
      activeArchivedTask,
      archivedTask,
      archivedArchivedTask,
    ]) {
      await expect(
        page.getByRole("button", { name: title, exact: true }),
      ).toBeVisible({
        timeout: 15000,
      });
    }
    const main = page.locator("main");
    const activeGroup = main.getByRole("button", {
      name: activeListName,
      exact: true,
    });
    const archivedGroup = main.getByRole("button", {
      name: archivedListName,
      exact: true,
    });
    await expect(activeGroup).toBeVisible();
    await expect(archivedGroup).toBeVisible();
    const activeGroupBox = await activeGroup.boundingBox();
    const archivedGroupBox = await archivedGroup.boundingBox();
    if (!activeGroupBox || !archivedGroupBox) {
      throw new Error("検索結果グループの境界ボックスを取得できない");
    }
    expect(activeGroupBox.y).toBeLessThan(archivedGroupBox.y);
  } finally {
    if (archivedList) {
      await page.locator("header select").selectOption("all");
      const archivedRow = page
        .getByTestId("list-item")
        .filter({ hasText: archivedListName });
      await archivedRow.getByTestId("list-menu-btn").click();
      await archivedRow.getByText("アーカイブ解除", { exact: true }).click();
    }
    await cleanupTestList(browser, activeListName);
    await cleanupTestList(browser, archivedListName);
  }
});
