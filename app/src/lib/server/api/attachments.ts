/**
 * @fileoverview 添付ファイル関連API（追加・削除・ダウンロード・一覧紐づけ）
 */

import { and, count, eq, inArray } from "drizzle-orm";

import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_TASK } from "$lib/schemas";
import type { AttachmentMeta } from "$lib/types";
import { getDb } from "../db";
import { attachments, lists, tasks } from "../schema";
import { toUtcIso } from "./common";

/**
 * タスクへ添付ファイルを追加する。
 *
 * トランザクション内で親タスク行を `FOR UPDATE` でロックし、件数上限判定と挿入を
 * 排他制御する。同一タスクへの並行追加や `deleteList` による親タスク削除との
 * 競合を防ぐ。
 */
export async function createAttachment(params: {
  userId: number;
  taskId: number;
  filename: string;
  mimeType: string;
  data: string;
}): Promise<{ attachmentId: number }> {
  const decoded = Buffer.from(params.data, "base64");
  if (decoded.length > MAX_ATTACHMENT_BYTES) {
    throw new Error("attachment_too_large");
  }

  return await getDb().transaction(async (tx) => {
    const taskRows = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, params.taskId))
      .for("update")
      .limit(1);
    if (taskRows.length === 0) throw new Error("task_not_found");
    const task = taskRows[0]!;

    const listRows = await tx
      .select()
      .from(lists)
      .where(and(eq(lists.id, task.list_id), eq(lists.user_id, params.userId)))
      .limit(1);
    if (listRows.length === 0) throw new Error("task_not_found");
    const list = listRows[0]!;

    const [{ existingCount }] = await tx
      .select({ existingCount: count() })
      .from(attachments)
      .where(eq(attachments.task_id, task.id));
    if (existingCount >= MAX_ATTACHMENTS_PER_TASK) {
      throw new Error("attachment_limit_exceeded");
    }

    const now = new Date();
    const inserted = await tx
      .insert(attachments)
      .values({
        task_id: task.id,
        filename: params.filename,
        mime_type: params.mimeType,
        size: decoded.length,
        data: decoded,
        created: now,
      })
      .$returningId();

    await tx.update(tasks).set({ updated: now }).where(eq(tasks.id, task.id));
    await tx
      .update(lists)
      .set({ last_updated: now })
      .where(eq(lists.id, list.id));

    return { attachmentId: inserted[0]!.id };
  });
}

/**
 * 添付ファイルを削除する。
 *
 * トランザクション内で親タスク行を `FOR UPDATE` でロックしてから削除する。
 * `createAttachment` の件数上限判定と同じ行をロック対象にすることで、
 * 削除と追加が競合しても不整合が生じない。
 */
export async function deleteAttachment(params: {
  userId: number;
  attachmentId: number;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const rows = await tx
      .select({ attachment: attachments, task: tasks, list: lists })
      .from(attachments)
      .innerJoin(tasks, eq(attachments.task_id, tasks.id))
      .innerJoin(lists, eq(tasks.list_id, lists.id))
      .where(
        and(
          eq(attachments.id, params.attachmentId),
          eq(lists.user_id, params.userId),
        ),
      )
      .limit(1);
    if (rows.length === 0) throw new Error("attachment_not_found");
    const { task, list } = rows[0]!;

    await tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .for("update")
      .limit(1);

    const now = new Date();
    await tx.delete(attachments).where(eq(attachments.id, params.attachmentId));
    await tx.update(tasks).set({ updated: now }).where(eq(tasks.id, task.id));
    await tx
      .update(lists)
      .set({ last_updated: now })
      .where(eq(lists.id, list.id));
  });
}

/** 添付ファイル本体をダウンロード用に取得する（所有権はタスク経由で確認する）。 */
export async function downloadAttachment(params: {
  userId: number;
  attachmentId: number;
}): Promise<{ filename: string; mimeType: string; data: string }> {
  const db = getDb();
  const rows = await db
    .select({ attachment: attachments })
    .from(attachments)
    .innerJoin(tasks, eq(attachments.task_id, tasks.id))
    .innerJoin(lists, eq(tasks.list_id, lists.id))
    .where(
      and(
        eq(attachments.id, params.attachmentId),
        eq(lists.user_id, params.userId),
      ),
    )
    .limit(1);
  if (rows.length === 0) throw new Error("attachment_not_found");
  const attachment = rows[0]!.attachment;

  return {
    filename: attachment.filename,
    mimeType: attachment.mime_type,
    data: Buffer.from(attachment.data).toString("base64"),
  };
}

/**
 * 複数タスクの添付メタ情報をまとめて取得する。
 *
 * `data` 列は除外し、`task_id` ごとにグループ化した `Map` を返す。
 * タスク一覧APIから呼び出し、ペイロード肥大化を避ける。
 */
export async function listAttachmentsForTasks(
  taskIds: number[],
): Promise<Map<number, AttachmentMeta[]>> {
  const result = new Map<number, AttachmentMeta[]>();
  if (taskIds.length === 0) return result;

  const db = getDb();
  const rows = await db
    .select({
      id: attachments.id,
      task_id: attachments.task_id,
      filename: attachments.filename,
      mime_type: attachments.mime_type,
      size: attachments.size,
      created: attachments.created,
    })
    .from(attachments)
    .where(inArray(attachments.task_id, taskIds));

  for (const r of rows) {
    const meta: AttachmentMeta = {
      id: r.id,
      filename: r.filename,
      mimeType: r.mime_type,
      size: r.size,
      created: toUtcIso(r.created),
    };
    const existing = result.get(r.task_id);
    if (existing) {
      existing.push(meta);
    } else {
      result.set(r.task_id, [meta]);
    }
  }
  return result;
}
