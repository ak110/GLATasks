/**
 * @fileoverview タスク添付ファイルの e2e テスト
 */

import { test, expect, type Page, type Locator } from "@playwright/test";
import * as fs from "node:fs/promises";
import { setupTestList, cleanupTestList } from "./helpers/common";

const LIST_NAME = `添付テスト_${Date.now()}`;

// 1x1 透過PNGの最小バイナリ（アイコン表示件数の確認用）
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

/** タスクを追加し、編集ダイアログを開いた状態にして、タスク行のlocatorを返す */
async function addTaskAndOpenEditDialog(
  page: Page,
  title: string,
): Promise<Locator> {
  await page.fill('textarea[placeholder*="タスクを追加"]', title);
  await page.click('[data-testid="task-add-form"] button[type="submit"]');
  const taskRow = page
    .locator('[data-testid="task-item"]')
    .filter({ hasText: title });
  await taskRow.waitFor({ timeout: 15000 });
  await taskRow.locator('[data-testid="task-edit-btn"]').dispatchEvent("click");
  await page
    .locator('[role="dialog"] input[type="file"]')
    .waitFor({ timeout: 15000 });
  return taskRow;
}

test.describe("attachments", () => {
  test.beforeAll(async ({ browser }) => {
    await setupTestList(browser, LIST_NAME);
  });

  test.afterAll(async ({ browser }) => {
    await cleanupTestList(browser, LIST_NAME);
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

  test("編集ダイアログでファイルを添付するとタスク行にアイコンが件数分表示される", async ({
    page,
  }) => {
    const title = `添付_${Date.now()}`;
    const taskRow = await addTaskAndOpenEditDialog(page, title);

    await page.locator('[role="dialog"] input[type="file"]').setInputFiles([
      {
        name: "memo.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("メモの内容"),
      },
      {
        name: "icon.png",
        mimeType: "image/png",
        buffer: Buffer.from(TINY_PNG_BASE64, "base64"),
      },
    ]);
    await page
      .locator('[role="dialog"] li')
      .filter({ hasText: "icon.png" })
      .waitFor({ timeout: 15000 });
    await page.keyboard.press("Escape");

    await expect(
      taskRow.locator('[data-testid="task-attachment-icon"]'),
    ).toHaveCount(2, { timeout: 15000 });
  });

  test("添付アイコンのtitle属性でファイル名を確認できる", async ({ page }) => {
    const title = `添付title確認_${Date.now()}`;
    const filename = `title確認_${Date.now()}.txt`;
    const taskRow = await addTaskAndOpenEditDialog(page, title);

    await page.locator('[role="dialog"] input[type="file"]').setInputFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: Buffer.from("title確認用の内容"),
    });
    await page
      .locator('[role="dialog"] li')
      .filter({ hasText: filename })
      .waitFor({ timeout: 15000 });
    await page.keyboard.press("Escape");

    await expect(
      taskRow.locator('[data-testid="task-attachment-icon"]'),
    ).toHaveAttribute("title", filename, { timeout: 15000 });
  });

  test("添付アイコンをクリックするとダウンロードが発火し内容が復元される", async ({
    page,
  }) => {
    const title = `ダウンロード_${Date.now()}`;
    const filename = `download_${Date.now()}.txt`;
    const content = `ダウンロード内容_${Date.now()}`;
    const taskRow = await addTaskAndOpenEditDialog(page, title);

    await page.locator('[role="dialog"] input[type="file"]').setInputFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: Buffer.from(content),
    });
    await page
      .locator('[role="dialog"] li')
      .filter({ hasText: filename })
      .waitFor({ timeout: 15000 });
    await page.keyboard.press("Escape");

    const icon = taskRow.locator('[data-testid="task-attachment-icon"]');
    await icon.waitFor({ timeout: 15000 });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      icon.click(),
    ]);
    expect(download.suggestedFilename()).toBe(filename);
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error("ダウンロードパスを取得できません");
    const downloaded = await fs.readFile(downloadPath, "utf-8");
    expect(downloaded).toBe(content);
  });

  test("10 MiB超過ファイルの添付はエラー通知で拒否される", async ({ page }) => {
    const title = `サイズ超過_${Date.now()}`;
    const taskRow = await addTaskAndOpenEditDialog(page, title);

    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);
    await page.locator('[role="dialog"] input[type="file"]').setInputFiles({
      name: "oversized.bin",
      mimeType: "application/octet-stream",
      buffer: oversized,
    });

    await expect(page.locator('[data-testid="toast-error"]')).toContainText(
      "ファイルサイズが上限を超えています",
      { timeout: 15000 },
    );
    await page.keyboard.press("Escape");
    await expect(
      taskRow.locator('[data-testid="task-attachment-icon"]'),
    ).toHaveCount(0);
  });

  test("既存添付を削除するとリロード後も削除が保たれる", async ({ page }) => {
    const title = `削除_${Date.now()}`;
    const filename = `delete_${Date.now()}.txt`;
    const taskRow = await addTaskAndOpenEditDialog(page, title);

    await page.locator('[role="dialog"] input[type="file"]').setInputFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: Buffer.from("削除確認用"),
    });
    const attachmentItem = page
      .locator('[role="dialog"] li')
      .filter({ hasText: filename });
    await attachmentItem.waitFor({ timeout: 15000 });

    await attachmentItem
      .locator(`button[aria-label="${filename}を削除"]`)
      .click();
    await expect(attachmentItem).toHaveCount(0, { timeout: 15000 });
    await page.keyboard.press("Escape");
    await expect(
      taskRow.locator('[data-testid="task-attachment-icon"]'),
    ).toHaveCount(0, { timeout: 15000 });

    await Promise.all([
      page.reload(),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
    const reloadedRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: title });
    await reloadedRow.waitFor({ timeout: 15000 });
    await expect(
      reloadedRow.locator('[data-testid="task-attachment-icon"]'),
    ).toHaveCount(0);
  });
});
