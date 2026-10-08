/**
 * @fileoverview 添付ファイルAPI（createAttachment・deleteAttachment・downloadAttachment・
 * listAttachmentsForTasks）の境界値・同値分割テスト。
 *
 * 開発用MariaDBへ実接続して検証する（`DATABASE_URL`が到達可能な環境で実行する）。
 */

import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";

import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TASK,
} from "#lib/schemas.ts";
import {
  createFixtureTask,
  cleanupFixtures,
  describeDb,
} from "../db-test-helpers";
import { getDb } from "../db";
import { attachments } from "../schema";
import {
  createAttachment,
  deleteAttachment,
  downloadAttachment,
  listAttachmentsForTasks,
} from "./attachments.js";

/** 指定件数のダミー添付を直接INSERTする（`createAttachment`呼び出しコストを避ける）。 */
async function seedAttachments(taskId: number, count: number): Promise<void> {
  if (count === 0) return;
  const now = new Date();
  await getDb()
    .insert(attachments)
    .values(
      Array.from({ length: count }, (_, i) => ({
        task_id: taskId,
        filename: `seed-${i}.txt`,
        mime_type: "text/plain",
        size: 1,
        data: Buffer.from("a"),
        created: now,
      })),
    );
}

describeDb("createAttachment", () => {
  const createdUserIds: number[] = [];

  afterAll(async () => {
    await cleanupFixtures(createdUserIds);
  });

  it("ちょうど10 MiBのファイルは受理し、10 MiB+1バイトは attachment_too_large で拒否する", async () => {
    const { userId, taskId } = await createFixtureTask();
    createdUserIds.push(userId);

    const exact = Buffer.alloc(MAX_ATTACHMENT_BYTES, 1).toString("base64");
    const result = await createAttachment({
      userId,
      taskId,
      filename: "exact.bin",
      mimeType: "application/octet-stream",
      data: exact,
    });
    expect(result.attachmentId).toBeGreaterThan(0);

    const over = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1).toString("base64");
    await expect(
      createAttachment({
        userId,
        taskId,
        filename: "over.bin",
        mimeType: "application/octet-stream",
        data: over,
      }),
    ).rejects.toThrowError("attachment_too_large");
  });

  it("99件目までは受理し100件目は attachment_limit_exceeded で拒否する", async () => {
    const { userId, taskId } = await createFixtureTask();
    createdUserIds.push(userId);
    await seedAttachments(taskId, MAX_ATTACHMENTS_PER_TASK - 1);

    const data = Buffer.from("boundary").toString("base64");
    const ok = await createAttachment({
      userId,
      taskId,
      filename: "99th.txt",
      mimeType: "text/plain",
      data,
    });
    expect(ok.attachmentId).toBeGreaterThan(0);

    await expect(
      createAttachment({
        userId,
        taskId,
        filename: "100th.txt",
        mimeType: "text/plain",
        data,
      }),
    ).rejects.toThrowError("attachment_limit_exceeded");
  });

  it("同一タスクへの並行作成は1件のみ成功し他方は attachment_limit_exceeded になる", async () => {
    const { userId, taskId } = await createFixtureTask();
    createdUserIds.push(userId);
    await seedAttachments(taskId, MAX_ATTACHMENTS_PER_TASK - 1);

    const data = Buffer.from("concurrent").toString("base64");
    const results = await Promise.allSettled([
      createAttachment({
        userId,
        taskId,
        filename: "concurrent-a.txt",
        mimeType: "text/plain",
        data,
      }),
      createAttachment({
        userId,
        taskId,
        filename: "concurrent-b.txt",
        mimeType: "text/plain",
        data,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const [rejectedResult] = rejected as PromiseRejectedResult[];
    expect((rejectedResult!.reason as Error).message).toBe(
      "attachment_limit_exceeded",
    );
  });

  it("他ユーザーのtaskIdを渡すと task_not_found をスローする", async () => {
    const owner = await createFixtureTask();
    const other = await createFixtureTask();
    createdUserIds.push(owner.userId, other.userId);

    await expect(
      createAttachment({
        userId: other.userId,
        taskId: owner.taskId,
        filename: "forbidden.txt",
        mimeType: "text/plain",
        data: Buffer.from("x").toString("base64"),
      }),
    ).rejects.toThrowError("task_not_found");
  });
});

describeDb("deleteAttachment", () => {
  const createdUserIds: number[] = [];

  afterAll(async () => {
    await cleanupFixtures(createdUserIds);
  });

  it("削除するとDB上のレコードが除去される", async () => {
    const { userId, taskId } = await createFixtureTask();
    createdUserIds.push(userId);
    const { attachmentId } = await createAttachment({
      userId,
      taskId,
      filename: "to-delete.txt",
      mimeType: "text/plain",
      data: Buffer.from("delete me").toString("base64"),
    });

    await deleteAttachment({ userId, attachmentId });

    const rows = await getDb()
      .select()
      .from(attachments)
      .where(eq(attachments.id, attachmentId));
    expect(rows).toHaveLength(0);
  });

  it("他人の添付と削除済みの添付への削除は成功し、他人の添付を変更しない", async () => {
    const owner = await createFixtureTask();
    const other = await createFixtureTask();
    createdUserIds.push(owner.userId, other.userId);
    const { attachmentId } = await createAttachment({
      userId: owner.userId,
      taskId: owner.taskId,
      filename: "owned.txt",
      mimeType: "text/plain",
      data: Buffer.from("owned").toString("base64"),
    });

    const before = await downloadAttachment({
      userId: owner.userId,
      attachmentId,
    });
    await deleteAttachment({ userId: other.userId, attachmentId });
    expect(
      await downloadAttachment({ userId: owner.userId, attachmentId }),
    ).toEqual(before);
    await deleteAttachment({ userId: owner.userId, attachmentId });
    await deleteAttachment({ userId: owner.userId, attachmentId });
    expect(
      await getDb()
        .select()
        .from(attachments)
        .where(eq(attachments.id, attachmentId)),
    ).toEqual([]);
  });
});

describeDb("downloadAttachment", () => {
  const createdUserIds: number[] = [];

  afterAll(async () => {
    await cleanupFixtures(createdUserIds);
  });

  it("追加したファイルをbase64で復元できる", async () => {
    const { userId, taskId } = await createFixtureTask();
    createdUserIds.push(userId);
    const original = Buffer.from("hello attachment");
    const { attachmentId } = await createAttachment({
      userId,
      taskId,
      filename: "download.txt",
      mimeType: "text/plain",
      data: original.toString("base64"),
    });

    const downloaded = await downloadAttachment({ userId, attachmentId });

    expect(downloaded.filename).toBe("download.txt");
    expect(downloaded.mimeType).toBe("text/plain");
    expect(Buffer.from(downloaded.data, "base64")).toEqual(original);
  });

  it("他ユーザーのattachmentIdを渡すと attachment_not_found をスローする", async () => {
    const owner = await createFixtureTask();
    const other = await createFixtureTask();
    createdUserIds.push(owner.userId, other.userId);
    const { attachmentId } = await createAttachment({
      userId: owner.userId,
      taskId: owner.taskId,
      filename: "owned.txt",
      mimeType: "text/plain",
      data: Buffer.from("owned").toString("base64"),
    });

    await expect(
      downloadAttachment({ userId: other.userId, attachmentId }),
    ).rejects.toThrowError("attachment_not_found");
  });
});

describeDb("listAttachmentsForTasks", () => {
  const createdUserIds: number[] = [];

  afterAll(async () => {
    await cleanupFixtures(createdUserIds);
  });

  it("空配列を渡すと空Mapを返す", async () => {
    const result = await listAttachmentsForTasks([]);
    expect(result.size).toBe(0);
  });

  it("複数タスクの添付をtask_idごとにグループ化して返す", async () => {
    const a = await createFixtureTask();
    const b = await createFixtureTask();
    createdUserIds.push(a.userId, b.userId);

    await createAttachment({
      userId: a.userId,
      taskId: a.taskId,
      filename: "a1.txt",
      mimeType: "text/plain",
      data: Buffer.from("a1").toString("base64"),
    });
    await createAttachment({
      userId: b.userId,
      taskId: b.taskId,
      filename: "b1.txt",
      mimeType: "text/plain",
      data: Buffer.from("b1").toString("base64"),
    });

    const result = await listAttachmentsForTasks([a.taskId, b.taskId]);
    expect(result.get(a.taskId)?.map((m) => m.filename)).toEqual(["a1.txt"]);
    expect(result.get(b.taskId)?.map((m) => m.filename)).toEqual(["b1.txt"]);
  });
});
