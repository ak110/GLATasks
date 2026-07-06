/**
 * @fileoverview 添付ファイルAPI（createAttachment・deleteAttachment・downloadAttachment・
 * listAttachmentsForTasks）の境界値・同値分割テスト。
 *
 * 開発用MariaDBへ実接続して検証する（`DATABASE_URL`が到達可能な環境で実行する）。
 */

import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_TASK } from "$lib/schemas";
import { getDb } from "../db";
import { attachments, lists, tasks, users } from "../schema";
import {
  createAttachment,
  deleteAttachment,
  downloadAttachment,
  listAttachmentsForTasks,
} from "./attachments.js";

/** テスト用ユーザー・リスト・タスクを1組作成する。 */
async function createFixtureTask(): Promise<{
  userId: number;
  listId: number;
  taskId: number;
}> {
  const db = getDb();
  const now = new Date();
  const [{ id: userId }] = await db
    .insert(users)
    .values({
      user: `attach${Math.random().toString(36).slice(2, 12)}`,
      pass_hash: "dummy",
      joined: now,
    })
    .$returningId();
  const [{ id: listId }] = await db
    .insert(lists)
    .values({
      user_id: userId,
      status: "active",
      title: "attachment test list",
      sort_order: 0,
      last_updated: now,
    })
    .$returningId();
  const [{ id: taskId }] = await db
    .insert(tasks)
    .values({
      list_id: listId,
      status: "active",
      text: "attachment test task",
      tags: "[]",
      sort_order: 0,
      created: now,
      updated: now,
    })
    .$returningId();
  return { userId, listId, taskId };
}

/** テストで作成した users・lists・tasks・attachments 行を削除する。 */
async function cleanupFixtures(userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  const db = getDb();
  const listRows = await db
    .select({ id: lists.id })
    .from(lists)
    .where(inArray(lists.user_id, userIds));
  const listIds = listRows.map((l) => l.id);
  if (listIds.length > 0) {
    const taskRows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.list_id, listIds));
    const taskIds = taskRows.map((t) => t.id);
    if (taskIds.length > 0) {
      await db.delete(attachments).where(inArray(attachments.task_id, taskIds));
      await db.delete(tasks).where(inArray(tasks.id, taskIds));
    }
    await db.delete(lists).where(inArray(lists.id, listIds));
  }
  await db.delete(users).where(inArray(users.id, userIds));
}

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

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

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
      deleteAttachment({ userId: other.userId, attachmentId }),
    ).rejects.toThrowError("attachment_not_found");
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
