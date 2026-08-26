/**
 * @fileoverview タスク添付ファイルの e2e テスト
 */

import { test, expect, type Page, type Locator } from "@playwright/test";
import * as fs from "node:fs/promises";
import {
  setupTestList,
  cleanupTestList,
  waitForPersistedTask,
} from "./helpers/common";
import {
  MUTATION_UI_DEADLINE_MS,
  observeMutationResponses,
  selectMutationDiagnosticObservation,
  serializeMutationDiagnostic,
  type MutationObservationTracker,
} from "./helpers/mutation-observation";
import { MAX_ATTACHMENT_BYTES } from "../src/lib/schemas";

const LIST_NAME = `添付テスト_${Date.now()}`;

// 1x1 透過PNGの最小バイナリ（添付テストのサンプル画像として使用）
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

type ExpectedAttachmentOutcome = "ok" | "error";

/** 添付UIの失敗時に、同じ操作のmutation境界を診断情報として返す */
async function expectAttachmentUiResult(
  tracker: MutationObservationTracker,
  assertUi: () => Promise<void>,
  expectedOutcome: ExpectedAttachmentOutcome,
): Promise<void> {
  try {
    await assertUi();
    tracker.markUiObserved();
    await Promise.all(tracker.responses);
    for (const observation of tracker.observations) {
      expect(observation.trpcOutcome).toBe(expectedOutcome);
    }
  } catch (error) {
    const observation = selectMutationDiagnosticObservation(
      tracker.observations,
    );
    if (!observation || observation.uiObservedAt !== null) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${serializeMutationDiagnostic(observation)}\n${message}`, {
      cause: error,
    });
  } finally {
    tracker.stop();
  }
}

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
  await waitForPersistedTask(taskRow);
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

    const attachmentObservation = observeMutationResponses(
      page,
      "attachments.create",
      2,
    );
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
    await expectAttachmentUiResult(
      attachmentObservation,
      async () => {
        await page
          .locator('[role="dialog"] li')
          .filter({ hasText: "icon.png" })
          .waitFor({ timeout: MUTATION_UI_DEADLINE_MS });
        await page.keyboard.press("Escape");

        await expect(
          taskRow.locator('[data-testid="task-attachment-icon"]'),
        ).toHaveCount(1, { timeout: MUTATION_UI_DEADLINE_MS });
        await expect(
          taskRow.locator('[data-testid="task-attachment-thumbnail"]'),
        ).toHaveCount(1, { timeout: MUTATION_UI_DEADLINE_MS });
      },
      "ok",
    );
  });

  test("添付アイコンのtitle属性でファイル名を確認できる", async ({ page }) => {
    const title = `添付title確認_${Date.now()}`;
    const filename = `title確認_${Date.now()}.txt`;
    const taskRow = await addTaskAndOpenEditDialog(page, title);

    const attachmentObservation = observeMutationResponses(
      page,
      "attachments.create",
    );
    await page.locator('[role="dialog"] input[type="file"]').setInputFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: Buffer.from("title確認用の内容"),
    });
    await expectAttachmentUiResult(
      attachmentObservation,
      async () => {
        await page
          .locator('[role="dialog"] li')
          .filter({ hasText: filename })
          .waitFor({ timeout: MUTATION_UI_DEADLINE_MS });
        await page.keyboard.press("Escape");

        await expect(
          taskRow.locator('[data-testid="task-attachment-icon"]'),
        ).toHaveAttribute("title", filename, {
          timeout: MUTATION_UI_DEADLINE_MS,
        });
      },
      "ok",
    );
  });

  test("添付アイコンをクリックするとダウンロードが発火し内容が復元される", async ({
    page,
  }) => {
    const title = `ダウンロード_${Date.now()}`;
    const filename = `download_${Date.now()}.txt`;
    const content = `ダウンロード内容_${Date.now()}`;
    const taskRow = await addTaskAndOpenEditDialog(page, title);

    const attachmentObservation = observeMutationResponses(
      page,
      "attachments.create",
    );
    await page.locator('[role="dialog"] input[type="file"]').setInputFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: Buffer.from(content),
    });
    await expectAttachmentUiResult(
      attachmentObservation,
      async () => {
        await page
          .locator('[role="dialog"] li')
          .filter({ hasText: filename })
          .waitFor({ timeout: MUTATION_UI_DEADLINE_MS });
        await page.keyboard.press("Escape");

        await expect(
          taskRow.locator('[data-testid="task-attachment-icon"]'),
        ).toHaveCount(1, { timeout: MUTATION_UI_DEADLINE_MS });
      },
      "ok",
    );

    const icon = taskRow.locator('[data-testid="task-attachment-icon"]');
    await icon.waitFor({ timeout: MUTATION_UI_DEADLINE_MS });
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
    const attachmentObservation = observeMutationResponses(
      page,
      "attachments.create",
    );
    await page.locator('[role="dialog"] input[type="file"]').setInputFiles({
      name: "oversized.bin",
      mimeType: "application/octet-stream",
      buffer: oversized,
    });

    await expectAttachmentUiResult(
      attachmentObservation,
      async () => {
        await expect(page.locator('[data-testid="toast-error"]')).toContainText(
          "ファイルサイズが上限を超えています",
          {
            timeout: MUTATION_UI_DEADLINE_MS,
          },
        );
        await page.keyboard.press("Escape");
        await expect(
          taskRow.locator('[data-testid="task-attachment-icon"]'),
        ).toHaveCount(0);
      },
      "error",
    );
  });

  test("既存添付を削除するとリロード後も削除が保たれる", async ({ page }) => {
    const title = `削除_${Date.now()}`;
    const filename = `delete_${Date.now()}.txt`;
    const taskRow = await addTaskAndOpenEditDialog(page, title);

    const attachmentObservation = observeMutationResponses(
      page,
      "attachments.create",
    );
    await page.locator('[role="dialog"] input[type="file"]').setInputFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: Buffer.from("削除確認用"),
    });
    const attachmentItem = page
      .locator('[role="dialog"] li')
      .filter({ hasText: filename });
    await expectAttachmentUiResult(
      attachmentObservation,
      async () => attachmentItem.waitFor({ timeout: MUTATION_UI_DEADLINE_MS }),
      "ok",
    );

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

  test("タスク追加時にファイルを指定するとタスク行にアイコンが表示される", async ({
    page,
  }) => {
    const title = `追加時添付_${Date.now()}`;
    await page.fill('textarea[placeholder*="タスクを追加"]', title);
    await page
      .locator('[data-testid="task-add-form"] input[type="file"]')
      .setInputFiles({
        name: "attach.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("追加時添付の内容"),
      });
    await page
      .locator('[data-testid="task-add-form"] li')
      .filter({ hasText: "attach.txt" })
      .waitFor({ timeout: 15000 });

    await Promise.all([
      page.click('[data-testid="task-add-form"] button[type="submit"]'),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: title });
    await taskRow.waitFor({ timeout: 15000 });
    await expect(
      taskRow.locator('[data-testid="task-attachment-icon"]'),
    ).toHaveCount(1, { timeout: 15000 });
  });

  test("タスク追加フォームへファイルをドラッグアンドドロップすると添付として追加される", async ({
    page,
  }) => {
    const title = `DnD追加_${Date.now()}`;
    await page.fill('textarea[placeholder*="タスクを追加"]', title);

    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      const file = new File(["DnD追加の内容"], "dnd-add.txt", {
        type: "text/plain",
      });
      dt.items.add(file);
      return dt;
    });
    const form = page.locator('[data-testid="task-add-form"]');
    await form.dispatchEvent("dragover", { dataTransfer });
    await form.dispatchEvent("drop", { dataTransfer });
    await page
      .locator('[data-testid="task-add-form"] li')
      .filter({ hasText: "dnd-add.txt" })
      .waitFor({ timeout: 15000 });

    await Promise.all([
      page.click('[data-testid="task-add-form"] button[type="submit"]'),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);
    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: title });
    await taskRow.waitFor({ timeout: 15000 });
    await expect(
      taskRow.locator('[data-testid="task-attachment-icon"]'),
    ).toHaveCount(1, { timeout: 15000 });
  });

  test("タスク追加フォームでサイズ超過ファイルを添付した際のエラートースト検証", async ({
    page,
  }) => {
    const title = `追加時サイズ超過_${Date.now()}`;
    await page.fill('textarea[placeholder*="タスクを追加"]', title);

    const oversized = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x41);
    await page
      .locator('[data-testid="task-add-form"] input[type="file"]')
      .setInputFiles({
        name: "oversized.bin",
        mimeType: "application/octet-stream",
        buffer: oversized,
      });
    await page
      .locator('[data-testid="task-add-form"] li')
      .filter({ hasText: "oversized.bin" })
      .waitFor({ timeout: 15000 });

    await Promise.all([
      page.click('[data-testid="task-add-form"] button[type="submit"]'),
      page.waitForResponse((res) => res.url().includes("/api/trpc")),
    ]);

    await expect(page.locator('[data-testid="toast-error"]')).toContainText(
      "ファイルサイズが上限を超えています",
      { timeout: 15000 },
    );
    const taskRow = page
      .locator('[data-testid="task-item"]')
      .filter({ hasText: title });
    await taskRow.waitFor({ timeout: 15000 });
    await expect(
      taskRow.locator('[data-testid="task-attachment-icon"]'),
    ).toHaveCount(0);
  });

  test("追加フォームでクリップボードから画像を貼り付けて添付できる", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator('[data-testid="task-add-form"] textarea').focus();
    await page.evaluate((base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], "", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const event = new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      const el = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="task-add-form"] textarea',
      );
      el?.dispatchEvent(event);
    }, TINY_PNG_BASE64);
    await expect(
      page.locator('[data-testid="task-add-form"]').getByText(/^clipboard-/),
    ).toBeVisible();
  });

  test("編集ダイアログでクリップボードから画像を貼り付けて添付できる", async ({
    page,
  }) => {
    await addTaskAndOpenEditDialog(page, `編集ダイアログ貼付_${Date.now()}`);
    await page.locator('[role="dialog"] textarea#edit-text').focus();
    const attachmentObservation = observeMutationResponses(
      page,
      "attachments.create",
    );
    await page.evaluate((base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], "", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const event = new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      const el = document.querySelector<HTMLTextAreaElement>(
        '[role="dialog"] textarea#edit-text',
      );
      el?.dispatchEvent(event);
    }, TINY_PNG_BASE64);
    await expectAttachmentUiResult(
      attachmentObservation,
      async () =>
        expect(
          page
            .locator('[role="dialog"]')
            .locator('[data-testid="task-attachment-thumbnail"]'),
        ).toBeVisible({ timeout: MUTATION_UI_DEADLINE_MS }),
      "ok",
    );
  });

  test("画像添付は一覧でサムネイル表示され、クリックで原寸ポップアップが開く", async ({
    page,
  }) => {
    const title = `画像プレビュー_${Date.now()}`;
    await addTaskAndOpenEditDialog(page, title);
    const attachmentObservation = observeMutationResponses(
      page,
      "attachments.create",
    );
    await page.locator('[role="dialog"] input[type="file"]').setInputFiles({
      name: "sample.png",
      mimeType: "image/png",
      buffer: Buffer.from(TINY_PNG_BASE64, "base64"),
    });
    await expectAttachmentUiResult(
      attachmentObservation,
      async () =>
        expect(
          page
            .locator('[role="dialog"]')
            .locator('[data-testid="task-attachment-thumbnail"]'),
        ).toBeVisible({ timeout: MUTATION_UI_DEADLINE_MS }),
      "ok",
    );
    await page.keyboard.press("Escape");
    const listThumbnail = page
      .locator('[data-testid="task-attachment-thumbnail"]')
      .first();
    await listThumbnail.click();
    await expect(page.locator('[data-testid="image-lightbox"]')).toBeVisible();
    await page.locator('[data-testid="image-lightbox-close"]').click();
    await expect(page.locator('[data-testid="image-lightbox"]')).toBeHidden();
  });

  test("タスク編集ダイアログ本体へファイルをドラッグアンドドロップすると添付として追加される", async ({
    page,
  }) => {
    const title = `DnD編集_${Date.now()}`;
    const taskRow = await addTaskAndOpenEditDialog(page, title);

    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      const file = new File(["DnD編集の内容"], "dnd-edit.txt", {
        type: "text/plain",
      });
      dt.items.add(file);
      return dt;
    });
    const dialogBody = page.locator('[role="dialog"] > div').first();
    const attachmentObservation = observeMutationResponses(
      page,
      "attachments.create",
    );
    await dialogBody.dispatchEvent("dragover", { dataTransfer });
    await dialogBody.dispatchEvent("drop", { dataTransfer });
    await expectAttachmentUiResult(
      attachmentObservation,
      async () => {
        await page
          .locator('[role="dialog"] li')
          .filter({ hasText: "dnd-edit.txt" })
          .waitFor({ timeout: MUTATION_UI_DEADLINE_MS });
        await page.keyboard.press("Escape");

        await expect(
          taskRow.locator('[data-testid="task-attachment-icon"]'),
        ).toHaveCount(1, { timeout: MUTATION_UI_DEADLINE_MS });
      },
      "ok",
    );
  });
});
