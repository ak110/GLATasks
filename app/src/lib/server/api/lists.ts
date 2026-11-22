import { ApiError } from "../api-errors";

import { and, asc, count, eq, inArray, min } from "drizzle-orm";

import type { ShowType } from "#lib/schemas.ts";
import { matchesShowType } from "#lib/show-type.ts";
import { getHeadSortOrder } from "#lib/task-order.ts";
import { adjustUpdatedTimestamps, mergeByTimestamp } from "../merge-utils";
import { getDb } from "../db";
import { attachments, lists, schedules, tasks } from "../schema";
import { toUtcIso, touchListUpdated, getOwnedList } from "./common";

export type ListInfo = Awaited<ReturnType<typeof listLists>>[number];

/**
 * ユーザーの全リストについて、未完了（status="active"または"running"）かつ kind="todo" の
 * タスク件数を list_id ごとに集計する。
 *
 * `listLists` のクエリ（lists 単独取得 + JS側フィルタ）とは別クエリとして扱う。
 * 1クエリのJOIN + GROUP BYへ統合せず2クエリ構成とすることで、
 * MySQLのGROUP BY厳格モードの影響を避ける。
 */
async function countTodoTasksByList(
  userId: number,
): Promise<Map<number, number>> {
  const db = getDb();
  const rows = await db
    .select({ listId: tasks.list_id, todoCount: count() })
    .from(tasks)
    .innerJoin(lists, eq(tasks.list_id, lists.id))
    .where(
      and(
        eq(lists.user_id, userId),
        inArray(tasks.status, ["active", "running"]),
        eq(tasks.kind, "todo"),
      ),
    )
    .groupBy(tasks.list_id);
  return new Map(rows.map((r) => [r.listId, r.todoCount]));
}

export async function listLists(userId: number, showType: ShowType) {
  const db = getDb();
  const rows = await db
    .select()
    .from(lists)
    .where(eq(lists.user_id, userId))
    .orderBy(asc(lists.title));
  const todoCounts = await countTodoTasksByList(userId);
  return rows
    .filter((r) => matchesShowType(r.status, showType, "list"))
    .map((r) => ({
      id: r.id,
      title: r.title,
      sortOrder: r.sort_order,
      lastUpdated: toUtcIso(r.last_updated),
      status: r.status,
      todoCount: todoCounts.get(r.id) ?? 0,
    }));
}

export async function createList(
  userId: number,
  title: string,
): Promise<number> {
  const db = getDb();
  const [{ minOrder }] = await db
    .select({ minOrder: min(lists.sort_order) })
    .from(lists)
    .where(eq(lists.user_id, userId));
  const sortOrder = getHeadSortOrder(minOrder === null ? [] : [minOrder]);
  const result = await db
    .insert(lists)
    .values({
      title,
      user_id: userId,
      status: "active",
      sort_order: sortOrder,
      last_updated: new Date(),
    })
    .$returningId();
  return result[0].id;
}

export async function clearList(userId: number, listId: number): Promise<void> {
  await getDb().transaction(async (db) => {
    await getOwnedList(listId, userId, db);
    await db
      .update(tasks)
      .set({ status: "archived", updated: new Date() })
      .where(and(eq(tasks.list_id, listId), eq(tasks.status, "completed")));
    await touchListUpdated(listId, db);
  });
}

export async function renameList(
  userId: number,
  listId: number,
  title: string,
): Promise<void> {
  await getDb().transaction(async (db) => {
    await getOwnedList(listId, userId, db);
    await db.update(lists).set({ title }).where(eq(lists.id, listId));
    await touchListUpdated(listId, db);
  });
}

export async function deleteList(
  userId: number,
  listId: number,
): Promise<void> {
  // 削除の冪等性は .claude/skills/add-trpc-procedure/SKILL.md「DB層の実装」に従う。
  // 外部キーの RESTRICT に合わせ、子テーブルを先に削除する。
  const db = getDb();
  await db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: lists.id })
      .from(lists)
      .where(and(eq(lists.id, listId), eq(lists.user_id, userId)))
      .limit(1);
    if (owned.length === 0) return;

    // task行を FOR UPDATE でロックし、createAttachment 側の同一行ロックと
    // 順序を揃えて競合を防ぐ。
    const taskRows = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.list_id, listId))
      .for("update");
    const taskIds = taskRows.map((t) => t.id);

    if (taskIds.length > 0) {
      await tx.delete(attachments).where(inArray(attachments.task_id, taskIds));
      await tx.delete(tasks).where(inArray(tasks.id, taskIds));
    }
    await tx.delete(schedules).where(eq(schedules.list_id, listId));
    await tx.delete(lists).where(eq(lists.id, listId));
  });
}

export async function archiveList(
  userId: number,
  listId: number,
): Promise<void> {
  await getOwnedList(listId, userId);
  const db = getDb();
  await db
    .update(lists)
    .set({ status: "archived" })
    .where(eq(lists.id, listId));
}

export async function mergeLists(
  userId: number,
  sourceListId: number,
  targetListId: number,
): Promise<void> {
  if (sourceListId === targetListId) {
    throw new ApiError("same_list");
  }
  await getDb().transaction(async (db) => {
    const sourceList = await getOwnedList(sourceListId, userId, db);
    const targetList = await getOwnedList(targetListId, userId, db);
    if (sourceList.status !== "active" || targetList.status !== "active") {
      throw new ApiError("list_not_active");
    }

    const [sourceTasks, targetTasks] = await Promise.all([
      db
        .select()
        .from(tasks)
        .where(eq(tasks.list_id, sourceListId))
        .orderBy(asc(tasks.sort_order)),
      db
        .select()
        .from(tasks)
        .where(eq(tasks.list_id, targetListId))
        .orderBy(asc(tasks.sort_order)),
    ]);

    const sourceAdjusted = adjustUpdatedTimestamps(sourceTasks);
    const targetAdjusted = adjustUpdatedTimestamps(targetTasks);

    const merged = mergeByTimestamp(
      targetTasks.map((t, i) => ({ task: t, adjusted: targetAdjusted[i]! })),
      sourceTasks.map((t, i) => ({ task: t, adjusted: sourceAdjusted[i]! })),
    );

    await Promise.all(
      merged.map(({ task, adjusted }, i) => {
        const newSortOrder = i * 1000;
        return db
          .update(tasks)
          .set({
            list_id: targetListId,
            sort_order: newSortOrder,
            ...(adjusted !== task.updated.getTime() && {
              updated: new Date(adjusted),
            }),
          })
          .where(eq(tasks.id, task.id));
      }),
    );

    await db
      .update(schedules)
      .set({ list_id: targetListId })
      .where(eq(schedules.list_id, sourceListId));

    await db.delete(lists).where(eq(lists.id, sourceListId));
    await touchListUpdated(targetListId, db);
  });
}

export async function unarchiveList(
  userId: number,
  listId: number,
): Promise<void> {
  await getOwnedList(listId, userId);
  const db = getDb();
  await db.update(lists).set({ status: "active" }).where(eq(lists.id, listId));
}
