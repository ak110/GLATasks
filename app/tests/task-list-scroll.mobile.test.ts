/**
 * @fileoverview モバイル表示におけるタスク一覧の内部スクロール回帰テスト
 */

import {
  test,
  expect,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { BASE_URL, STORAGE_STATE_PATH } from "./helpers/common";
import { MAX_ATTACHMENTS_PER_TASK } from "../src/lib/schemas";

const LIST_NAME = `モバイルスクロール_${Date.now()}`;

async function cleanupTaskList(
  browser: Browser,
  listName: string,
): Promise<void> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE_PATH,
    ignoreHTTPSErrors: true,
  });
  try {
    const page = await context.newPage();
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((response) => response.url().includes("/api/trpc")),
    ]);
    const listRow = page.getByTestId("list-item").filter({ hasText: listName });
    await listRow.getByTestId("list-menu-btn").click();
    await page.getByTestId("list-delete-btn").click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "削除" })
      .click();
    await expect(listRow).toHaveCount(0);
  } finally {
    await context.close();
  }
}

async function setupMobileTestList(
  browser: Browser,
  listName: string,
): Promise<void> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE_PATH,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await Promise.all([
    page.goto("/"),
    page.waitForResponse((response) => response.url().includes("/api/trpc")),
  ]);
  await page.fill('aside input[placeholder="新しいリスト"]', listName);
  await page.click('aside button[type="submit"]');
  await page
    .locator(`[data-testid="list-select-btn"]:has-text("${listName}")`)
    .waitFor({ state: "attached", timeout: 15000 });
  await context.close();
}

const MINIMUM_TASK_ROWS = 18;
const MAX_TAGS_PER_TASK = 32;

function makeLongTagNames(prefix: string, stamp: number): string[] {
  return Array.from(
    { length: MAX_TAGS_PER_TASK },
    (_, index) =>
      `${prefix}_${stamp}_${index.toString().padStart(2, "0")}_${"長".repeat(12)}`,
  );
}

async function requireBoundingBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("要素の境界ボックスを取得できません");
  return box;
}

async function verifyTaskListInternalScroll(
  page: Page,
  listName: string,
): Promise<void> {
  const taskList = page.getByTestId("task-list-scroll");
  const taskItems = page.getByTestId("task-item");
  const form = page.getByTestId("task-add-form");
  const textarea = form.locator("textarea");
  const submitButton = form.locator('button[type="submit"]');
  const stamp = Date.now();

  for (let i = await taskItems.count(); i < MINIMUM_TASK_ROWS; i++) {
    const title = `スクロール_${stamp}_${i}`;
    await textarea.click();
    await textarea.fill(title);
    await expect(submitButton).toBeVisible();
    await submitButton.click();
    await expect(taskItems.filter({ hasText: title })).toBeVisible({
      timeout: 15000,
    });
  }

  const heading = page.getByRole("heading", { name: listName, exact: true });
  const firstTask = taskItems.first();
  await expect(heading).toBeVisible();
  await expect(form).toBeVisible();
  await expect(taskList).toBeVisible();

  await taskList.evaluate((element) => {
    element.scrollTop = 0;
  });
  const dimensions = await taskList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

  const headingBefore = await requireBoundingBox(heading);
  const formBefore = await requireBoundingBox(form);
  const firstTaskBefore = await requireBoundingBox(firstTask);

  await taskList.evaluate((element) => {
    element.scrollTop = Math.min(
      160,
      element.scrollHeight - element.clientHeight,
    );
  });
  await expect
    .poll(() => taskList.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);

  const headingAfter = await requireBoundingBox(heading);
  const formAfter = await requireBoundingBox(form);
  const firstTaskAfter = await requireBoundingBox(firstTask);
  expect(headingAfter.y).toBeCloseTo(headingBefore.y, 1);
  expect(formAfter.y).toBeCloseTo(formBefore.y, 1);
  expect(firstTaskAfter.y).toBeLessThan(firstTaskBefore.y);

  await textarea.focus();
  await expect(submitButton).toBeVisible();
  await expect(heading).toBeVisible();
  await expect(form).toBeVisible();
  await expect(taskList).toBeVisible();

  const expandedForm = await requireBoundingBox(form);
  const remainingList = await requireBoundingBox(taskList);
  expect(remainingList.height).toBeGreaterThan(0);
  expect(remainingList.y).toBeGreaterThanOrEqual(
    expandedForm.y + expandedForm.height - 1,
  );

  await page.getByTestId("search-input").fill(`該当なし_${stamp}`);
  await expect(page.locator("main")).toHaveCSS("overflow-y", "auto");
}

async function verifyAttachmentListKeepsTaskListAvailable(
  page: Page,
): Promise<void> {
  const form = page.getByTestId("task-add-form");
  const attachmentList = form.getByTestId("selected-attachments");
  const taskList = page.getByTestId("task-list-scroll");

  await form.locator("textarea").focus();
  await form.locator('input[type="file"]').setInputFiles(
    Array.from({ length: MAX_ATTACHMENTS_PER_TASK }, (_, index) => ({
      name: `attachment-${index}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from("添付"),
    })),
  );
  await expect(attachmentList.locator("li")).toHaveCount(
    MAX_ATTACHMENTS_PER_TASK,
  );

  const attachmentListDimensions = await attachmentList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(attachmentListDimensions.scrollHeight).toBeGreaterThan(
    attachmentListDimensions.clientHeight,
  );

  const taskListBox = await requireBoundingBox(taskList);
  expect(taskListBox.height).toBeGreaterThan(0);

  await attachmentList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => attachmentList.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(form.locator("textarea")).toBeVisible();
}

async function addTags(input: Locator, tagNames: string[]): Promise<void> {
  for (const tagName of tagNames) {
    await input.fill(tagName);
    await input.press("Enter");
  }
}

async function verifyTagListsKeepTaskListAvailable(page: Page): Promise<void> {
  const form = page.getByTestId("task-add-form");
  const tagEditor = form.getByTestId("tag-editor");
  const tagInput = tagEditor.getByTestId("tag-editor-input");
  const taskList = page.getByTestId("task-list-scroll");
  const stamp = Date.now();
  const candidateTags = makeLongTagNames("候補", stamp);
  const currentTags = makeLongTagNames("現在", stamp);
  const candidatePrefix = `候補_${stamp}_`;
  const currentPrefix = `現在_${stamp}_`;
  const sourceTaskTitle = `候補タグ源_${stamp}`;

  await form.locator("textarea").fill(sourceTaskTitle);
  await addTags(tagInput, candidateTags);
  await expect(
    tagEditor.getByTestId("tag-editor-current").filter({
      hasText: candidatePrefix,
    }),
  ).toHaveCount(MAX_TAGS_PER_TASK);
  await form.locator('button[type="submit"]').click();
  await expect(
    page.getByTestId("task-item").filter({ hasText: sourceTaskTitle }),
  ).toBeVisible({ timeout: 15000 });

  await form.locator("textarea").focus();
  await expect(
    tagEditor.getByTestId("tag-editor-candidate").filter({
      hasText: candidatePrefix,
    }),
  ).toHaveCount(MAX_TAGS_PER_TASK);
  await addTags(tagInput, currentTags);
  await expect(
    tagEditor.getByTestId("tag-editor-current").filter({
      hasText: currentPrefix,
    }),
  ).toHaveCount(MAX_TAGS_PER_TASK);

  const currentTagsArea = tagEditor.getByTestId("tag-editor-current-list");
  const candidateTagsArea = tagEditor.getByTestId("tag-editor-candidates-list");
  for (const tagArea of [currentTagsArea, candidateTagsArea]) {
    const dimensions = await tagArea.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    await tagArea.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => tagArea.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
  }

  const taskListBox = await requireBoundingBox(taskList);
  expect(taskListBox.height).toBeGreaterThan(0);
  await expect(tagInput).toBeVisible();
}

test.describe("task list scroll", () => {
  test.beforeAll(async ({ browser }) => {
    await setupMobileTestList(browser, LIST_NAME);
  });

  test.afterAll(async ({ browser }) => {
    await cleanupTaskList(browser, LIST_NAME);
  });

  test.beforeEach(async ({ page }) => {
    await Promise.all([
      page.goto("/"),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
    await page.click(
      `[data-testid="list-select-btn"]:has-text("${LIST_NAME}")`,
    );
    await page
      .locator('[data-testid="task-add-form"]')
      .waitFor({ timeout: 15000 });
  });

  test("タスク一覧だけをスクロールし見出しと追加フォームを表示したままにする", async ({
    page,
  }) => {
    await verifyTaskListInternalScroll(page, LIST_NAME);
  });

  test("選択済み添付が上限件数でもタスク一覧を操作できる", async ({ page }) => {
    await verifyAttachmentListKeepsTaskListAvailable(page);
  });

  test("多数の現在タグと候補があってもタスク一覧を操作できる", async ({
    page,
  }) => {
    await verifyTagListsKeepTaskListAvailable(page);
  });
});
