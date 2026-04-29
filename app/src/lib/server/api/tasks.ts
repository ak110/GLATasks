/**
 * @fileoverview タスク関連API（取得・追加・更新・検索・並び替え）
 */

import { and, asc, eq, inArray, like, min } from "drizzle-orm";
import type { z } from "zod";

import type { UpdateTaskSchema } from "$lib/schemas";
import type {
  TagInfo,
  TaskInfo,
  SearchTaskResult,
  GetTasksResult,
} from "$lib/types";
import { getDb } from "../db";
import { lists, tasks } from "../schema";
import {
  toUtcIso,
  fromUtcIso,
  parseTags,
  serializeTags,
  splitTitle,
  splitNotes,
  touchListUpdated,
  getOwnedList,
} from "./common";

export type { TagInfo, TaskInfo, SearchTaskResult, GetTasksResult };

/** patchTask の data 引数型（UpdateTaskSchema から listId・taskId を除いた型） */
type PatchTaskData = Omit<
  z.infer<typeof UpdateTaskSchema>,
  "listId" | "taskId"
>;

/** リストのタスク一覧を取得する（If-Modified-Since キャッシュ対応）。 */
export async function getListTasks(
  userId: number,
  listId: number,
  showType: string,
  ifModifiedSince?: string,
): Promise<GetTasksResult> {
  const list = await getOwnedList(listId, userId);

  if (ifModifiedSince) {
    try {
      const clientMs = new Date(ifModifiedSince).getTime();
      const serverMs = list.last_updated.getTime();
      if (serverMs <= clientMs) return { status: 304 };
    } catch {
      // パースに失敗した場合は通常のレスポンスを返す
    }
  }

  const db = getDb();
  const allTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.list_id, listId))
    .orderBy(asc(tasks.sort_order));

  const data: TaskInfo[] = allTasks
    .filter((t) => {
      if (showType === "all") return true;
      if (showType === "active") return t.status !== "archived";
      if (showType === "archived") return t.status === "archived";
      return true;
    })
    .map((t) => ({
      id: t.id,
      title: splitTitle(t.text),
      notes: splitNotes(t.text),
      status: t.status,
      tags: parseTags(t.tags),
    }));

  const lastModified = toUtcIso(list.last_updated);
  return { status: 200, data, lastModified };
}

/** タスクを追加する。sort_order は既存の最小値 - 1000（先頭追加）。 */
export async function postTask(
  userId: number,
  listId: number,
  text: string,
  tagList: TagInfo[] = [],
): Promise<void> {
  await getOwnedList(listId, userId);
  const cleanText = text.trimEnd();
  const db = getDb();
  const now = new Date();
  // 現在の最小 sort_order を取得
  const [{ minOrder }] = await db
    .select({ minOrder: min(tasks.sort_order) })
    .from(tasks)
    .where(eq(tasks.list_id, listId));
  const sortOrder = (minOrder ?? 1000) - 1000;
  await db.insert(tasks).values({
    list_id: listId,
    status: "active",
    text: cleanText,
    tags: serializeTags(tagList),
    sort_order: sortOrder,
    created: now,
    updated: now,
  });
  await touchListUpdated(listId);
}

/**
 * タスクを更新する（部分更新）。
 *
 * data のキーに応じて以下の更新パターンを処理する:
 * - text: テキスト変更 + keep_order=false なら先頭移動
 * - status: ステータス変更（active→completed 時に completed 日時を自動セット）
 * - completed: 完了日時の明示的な上書き（null でクリア）
 * - move_to: 別リストへの移動（移動先リストの先頭に配置）
 *
 * 各パターンは同時に適用可能（例: テキスト変更 + リスト移動）。
 */
export async function patchTask(
  userId: number,
  listId: number,
  taskId: number,
  data: PatchTaskData,
): Promise<void> {
  await getOwnedList(listId, userId);

  const db = getDb();
  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.list_id, listId)))
    .limit(1);
  if (taskRows.length === 0) throw new Error("task_not_found");
  const task = taskRows[0];

  const updates: Partial<typeof tasks.$inferInsert> = {};

  if (data.text !== undefined) {
    updates.text = data.text.trimEnd();
    // keep_order=true の場合は sort_order を維持、false の場合は先頭に移動
    if (!data.keep_order) {
      const [{ minOrder }] = await db
        .select({ minOrder: min(tasks.sort_order) })
        .from(tasks)
        .where(eq(tasks.list_id, listId));
      const currentMin = minOrder ?? task.sort_order;
      if (task.sort_order > currentMin) {
        updates.sort_order = currentMin - 1000;
      }
    }
    updates.updated = new Date();
  }
  if (data.status !== undefined) {
    if (task.status === "active" && data.status === "completed") {
      updates.completed = new Date();
    }
    updates.status = data.status;
  }
  if ("completed" in data) {
    updates.completed =
      data.completed === null || data.completed === undefined
        ? null
        : fromUtcIso(data.completed);
  }
  if (data.tags !== undefined) {
    updates.tags = serializeTags(data.tags);
    updates.updated = new Date();
  }

  if (data.move_to !== undefined) {
    const moveTo = data.move_to;
    if (moveTo !== listId) {
      await getOwnedList(moveTo, userId);
      updates.list_id = moveTo;
      // 移動先リストの先頭に配置
      const [{ minOrder }] = await db
        .select({ minOrder: min(tasks.sort_order) })
        .from(tasks)
        .where(eq(tasks.list_id, moveTo));
      updates.sort_order = (minOrder ?? 1000) - 1000;
      await touchListUpdated(moveTo);
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.update(tasks).set(updates).where(eq(tasks.id, taskId));
  }
  await touchListUpdated(listId);
}

/** 全リスト横断でタスクを LIKE 検索する */
export async function searchTasks(
  userId: number,
  query: string,
): Promise<SearchTaskResult[]> {
  const db = getDb();
  // ユーザーの active リストを取得
  const userLists = await db
    .select()
    .from(lists)
    .where(and(eq(lists.user_id, userId), eq(lists.status, "active")));
  if (userLists.length === 0) return [];

  // LIKE 用にワイルドカードをエスケープ
  const escaped = query.replace(/[%_]/g, "\\$&");
  const pattern = `%${escaped}%`;

  const listIds = userLists.map((l) => l.id);
  const rows = await db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.list_id, listIds), like(tasks.text, pattern)))
    .orderBy(asc(tasks.sort_order));

  // listId → title のマップ
  const listMap = new Map(userLists.map((l) => [l.id, l.title]));
  return rows
    .filter((t) => t.status !== "archived")
    .map((t) => ({
      id: t.id,
      title: splitTitle(t.text),
      notes: splitNotes(t.text),
      status: t.status,
      tags: parseTags(t.tags),
      listId: t.list_id,
      listTitle: listMap.get(t.list_id) ?? "",
    }));
}

/** タスクの並び順を更新する */
export async function reorderTasks(
  userId: number,
  listId: number,
  taskIds: number[],
): Promise<void> {
  await getOwnedList(listId, userId);
  const db = getDb();
  // taskIds の順に sort_order を 0, 1000, 2000... で再割当
  // 依存関係のないタスクの更新を並列実行し RTT の線形積み上がりを回避する
  await Promise.all(
    taskIds.map((id, i) =>
      db
        .update(tasks)
        .set({ sort_order: i * 1000 })
        .where(and(eq(tasks.id, id), eq(tasks.list_id, listId))),
    ),
  );
  await touchListUpdated(listId);
}
