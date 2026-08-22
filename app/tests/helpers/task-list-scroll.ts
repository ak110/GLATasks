/**
 * @fileoverview タスク一覧の内部スクロール回帰テスト用ヘルパー
 */

import { expect, type Locator, type Page } from "@playwright/test";
import { MAX_ATTACHMENTS_PER_TASK } from "../../src/lib/schemas";
import { toggleTaskAndWaitForUpdate } from "./common";

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

export async function prepareScrollableTaskList(page: Page): Promise<void> {
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
}

export async function scrollTaskListDown(page: Page): Promise<number> {
  const taskList = page.getByTestId("task-list-scroll");
  await taskList.evaluate((element) => {
    element.scrollTop = Math.min(
      160,
      element.scrollHeight - element.clientHeight,
    );
  });
  await expect
    .poll(() => taskList.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  return taskList.evaluate((element) => element.scrollTop);
}

export async function verifyTaskListInternalScroll(
  page: Page,
  listName: string,
): Promise<void> {
  const taskList = page.getByTestId("task-list-scroll");
  const taskItems = page.getByTestId("task-item");
  const form = page.getByTestId("task-add-form");
  const textarea = form.locator("textarea");
  const submitButton = form.locator('button[type="submit"]');
  const stamp = Date.now();

  await prepareScrollableTaskList(page);

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

  await scrollTaskListDown(page);

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

export async function verifyTaskAdditionScrollsToTop(
  page: Page,
): Promise<void> {
  await prepareScrollableTaskList(page);
  await scrollTaskListDown(page);

  const taskList = page.getByTestId("task-list-scroll");
  const taskItems = page.getByTestId("task-item");
  const form = page.getByTestId("task-add-form");
  const title = `追加後スクロール_${Date.now()}`;
  await form.locator("textarea").fill(title);
  await form.locator('button[type="submit"]').click();

  await expect(taskItems.first()).toContainText(title, { timeout: 15000 });
  await expect
    .poll(() => taskList.evaluate((element) => element.scrollTop))
    .toBe(0);
}

export async function verifyAttachmentListKeepsTaskListAvailable(
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

export async function verifyTagListsKeepTaskListAvailable(
  page: Page,
  includeMaximumAttachments = false,
): Promise<void> {
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

  const attachmentList = form.getByTestId("selected-attachments");
  if (includeMaximumAttachments) {
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
  }

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

  if (includeMaximumAttachments) {
    const formDimensions = await form.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(formDimensions.scrollHeight).toBeGreaterThan(
      formDimensions.clientHeight,
    );
    await form.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => form.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
  }

  const taskListBox = await requireBoundingBox(taskList);
  expect(taskListBox.height).toBeGreaterThan(0);
  if (includeMaximumAttachments) {
    const checkbox = taskList.getByRole("checkbox").first();
    await toggleTaskAndWaitForUpdate(page, checkbox);
    await toggleTaskAndWaitForUpdate(page, checkbox);
    await expect(checkbox).toBeChecked();
  }
  await expect(tagInput).toBeVisible();
}
