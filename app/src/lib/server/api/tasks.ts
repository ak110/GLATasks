/**
 * @fileoverview タスク関連API（取得・追加・更新・検索・並び替え）
 */

import { and, asc, eq, gte, inArray, like, min, ne } from "drizzle-orm";
import type { z } from "zod";

import type {
  ShowType,
  TagInfo,
  TaskKind,
  UpdateTaskSchema,
} from "#lib/schemas.ts";
import { matchesShowType } from "#lib/show-type.ts";
import { getHeadSortOrder } from "#lib/task-order.ts";
import { getDb } from "../db";
import { lists, tasks } from "../schema";
import { listAttachmentsForTasks } from "./attachments";
import {
  toUtcIso,
  fromUtcIso,
  parseTags,
  serializeTags,
  splitTitle,
  splitNotes,
  touchListUpdated,
  getOwnedList,
  type DbConnection,
} from "./common";

export type { TagInfo } from "#lib/schemas.ts";

/** updateTask の data 引数型（UpdateTaskSchema から listId・taskId を除いた型） */
type UpdateTaskData = Omit<
  z.infer<typeof UpdateTaskSchema>,
  "listId" | "taskId"
>;

function toTaskInfo(
  task: typeof tasks.$inferSelect,
  attachments: Awaited<ReturnType<typeof listAttachmentsForTasks>>,
) {
  return {
    id: task.id,
    title: splitTitle(task.text),
    notes: splitNotes(task.text),
    status: task.status,
    kind: task.kind,
    tags: parseTags(task.tags),
    attachments: attachments.get(task.id) ?? [],
  };
}

export type TaskInfo = ReturnType<typeof toTaskInfo>;
export type SearchTaskResult = Awaited<ReturnType<typeof searchTasks>>[number];
export type GetTasksResult = Awaited<ReturnType<typeof listTasks>>;
export type GetActiveTasksResult = Awaited<ReturnType<typeof listActiveTasks>>;
export type TaskListItem = GetActiveTasksResult["tasks"][number];

/**
 * ユーザーの全アクティブタスクを取得する（差分syncサポート）。
 *
 * - `since` 未指定（初回・全件モード）: archived でない全タスクを返す。
 * - `since` 指定（差分モード）: updated が since 以降のタスクを archived 含めて全件返す。
 * - ユーザーがアクティブリストを1件も持たない場合は、上記によらず空配列を返す
 *   （mode 判定は since の有無に従う）。
 *
 * `serverTime` は DB の TIMESTAMP 秒精度の取りこぼしを避けるため 1 秒 overlap させた値とする。
 */
export async function listActiveTasks(userId: number, since?: Date) {
  const db = getDb();

  // ユーザーの全アクティブリストを取得
  const userLists = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.user_id, userId), eq(lists.status, "active")));
  const listIds = userLists.map((l) => l.id);

  let rows: (typeof tasks.$inferSelect)[];
  let mode: "full" | "delta";

  if (listIds.length === 0) {
    rows = [];
    mode = since ? "delta" : "full";
  } else if (since) {
    // 差分モード: updated >= since のタスクを全件返す（archived 含む）
    rows = await db
      .select()
      .from(tasks)
      .where(and(inArray(tasks.list_id, listIds), gte(tasks.updated, since)));
    mode = "delta";
  } else {
    // 全件モード: archived でないタスクのみ返す
    rows = await db
      .select()
      .from(tasks)
      .where(
        and(inArray(tasks.list_id, listIds), ne(tasks.status, "archived")),
      );
    mode = "full";
  }

  const attachmentsByTask = await listAttachmentsForTasks(
    rows.map((t) => t.id),
  );
  const taskList = rows.map((t) => ({
    ...toTaskInfo(t, attachmentsByTask),
    listId: t.list_id,
    sortOrder: t.sort_order,
    updated: toUtcIso(t.updated),
  }));

  // 1秒overlap: DB の TIMESTAMP 秒精度に合わせ、現在時刻のミリ秒を除去した上で
  // さらに1秒以上前の値を返す。リクエスト間隔に応じて最大で約2秒前にずれるが、
  // gte(updated, since) は包含比較なので同秒内の更新を取り逃さない。
  const now = new Date();
  const overlapMs = Math.floor((now.getTime() - 1000) / 1000) * 1000;
  const serverTime = new Date(overlapMs).toISOString();

  return { tasks: taskList, serverTime, mode };
}

/** リストのタスク一覧を取得する（If-Modified-Since キャッシュ対応）。 */
export async function listTasks(
  userId: number,
  listId: number,
  showType: ShowType,
  ifModifiedSince?: string,
) {
  const list = await getOwnedList(listId, userId);

  if (ifModifiedSince) {
    try {
      const clientMs = new Date(ifModifiedSince).getTime();
      const serverMs = list.last_updated.getTime();
      if (serverMs <= clientMs) return { status: 304 as const };
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

  const filteredTasks = allTasks.filter((t) =>
    matchesShowType(t.status, showType),
  );
  const attachmentsByTask = await listAttachmentsForTasks(
    filteredTasks.map((t) => t.id),
  );
  const data = filteredTasks.map((t) => toTaskInfo(t, attachmentsByTask));

  const lastModified = toUtcIso(list.last_updated);
  return { status: 200 as const, data, lastModified };
}

/** タスクを先頭に追加する。渡された接続がある場合は呼出元のトランザクションへ参加する。 */
export async function createTask(
  userId: number,
  listId: number,
  text: string,
  tagList: TagInfo[] = [],
  kind: TaskKind = "normal",
  connection?: DbConnection,
): Promise<number> {
  const insertTask = async (db: DbConnection) => {
    await getOwnedList(listId, userId, db);
    const cleanText = text.trimEnd();
    const now = new Date();
    // 現在の最小 sort_order を取得
    const [{ minOrder }] = await db
      .select({ minOrder: min(tasks.sort_order) })
      .from(tasks)
      .where(eq(tasks.list_id, listId));
    const sortOrder = getHeadSortOrder(minOrder === null ? [] : [minOrder]);
    const result = await db
      .insert(tasks)
      .values({
        list_id: listId,
        status: "active",
        kind,
        text: cleanText,
        tags: serializeTags(tagList),
        sort_order: sortOrder,
        created: now,
        updated: now,
      })
      .$returningId();
    await touchListUpdated(listId, db);
    return result[0].id;
  };
  return connection ? insertTask(connection) : getDb().transaction(insertTask);
}

/**
 * タスクを更新する（部分更新）。
 *
 * data のキーに応じて以下の更新パターンを処理する:
 * - text: テキスト変更 + keepOrder=false なら先頭移動
 * - status: ステータス変更（未完了状態から completed への変更時に completed 日時を自動セット）
 * - completed: 完了日時の明示的な上書き（null でクリア）
 * - moveTo: 別リストへの移動（移動先リストの先頭に配置）
 *
 * 各パターンは同時に適用可能（例: テキスト変更 + リスト移動）。
 */
export async function updateTask(
  userId: number,
  listId: number,
  taskId: number,
  data: UpdateTaskData,
): Promise<void> {
  await getDb().transaction(async (db) => {
    await getOwnedList(listId, userId, db);
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
      if (!data.keepOrder) {
        const [{ minOrder }] = await db
          .select({ minOrder: min(tasks.sort_order) })
          .from(tasks)
          .where(eq(tasks.list_id, listId));
        const currentMin = minOrder ?? task.sort_order;
        if (task.sort_order > currentMin) {
          updates.sort_order = getHeadSortOrder([currentMin]);
        }
      }
      updates.updated = new Date();
    }
    if (data.status !== undefined) {
      if (task.status !== "completed" && data.status === "completed") {
        updates.completed = new Date();
      }
      updates.status = data.status;
      updates.updated = new Date();
    }
    if ("completed" in data) {
      updates.completed =
        data.completed === null || data.completed === undefined
          ? null
          : fromUtcIso(data.completed);
      updates.updated = new Date();
    }
    if (data.tags !== undefined) {
      updates.tags = serializeTags(data.tags);
      updates.updated = new Date();
    }
    if (data.kind !== undefined) {
      updates.kind = data.kind;
      updates.updated = new Date();
    }

    if (data.moveTo !== undefined) {
      const moveTo = data.moveTo;
      if (moveTo !== listId) {
        await getOwnedList(moveTo, userId, db);
        updates.list_id = moveTo;
        // 移動先リストの先頭に配置
        const [{ minOrder }] = await db
          .select({ minOrder: min(tasks.sort_order) })
          .from(tasks)
          .where(eq(tasks.list_id, moveTo));
        updates.sort_order = getHeadSortOrder(
          minOrder === null ? [] : [minOrder],
        );
        updates.updated = new Date();
        await touchListUpdated(moveTo, db);
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.update(tasks).set(updates).where(eq(tasks.id, taskId));
    }
    await touchListUpdated(listId, db);
  });
}

/** 全リスト横断でタスクを LIKE 検索する */
export async function searchTasks(
  userId: number,
  query: string,
  showType: ShowType,
) {
  const db = getDb();
  // active 表示では active リストだけ、それ以外ではユーザーの全リストを対象にする
  const userLists = await db
    .select()
    .from(lists)
    .where(eq(lists.user_id, userId));
  const visibleLists = userLists.filter((list) =>
    matchesShowType(list.status, showType, "list"),
  );
  if (visibleLists.length === 0) return [];

  // LIKE 用にワイルドカードをエスケープ
  const escaped = query.replace(/[%_]/g, "\\$&");
  const pattern = `%${escaped}%`;

  const listIds = visibleLists.map((l) => l.id);
  const rows = await db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.list_id, listIds), like(tasks.text, pattern)))
    .orderBy(asc(tasks.sort_order));

  // listId → title のマップ
  const listMap = new Map(visibleLists.map((l) => [l.id, l.title]));
  const matchedTasks = rows.filter((t) => matchesShowType(t.status, showType));
  const attachmentsByTask = await listAttachmentsForTasks(
    matchedTasks.map((t) => t.id),
  );
  return matchedTasks.map((t) => ({
    ...toTaskInfo(t, attachmentsByTask),
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
  await getDb().transaction(async (db) => {
    await getOwnedList(listId, userId, db);
    const now = new Date();
    // taskIds の順に sort_order を 0, 1000, 2000... で再割当
    await Promise.all(
      taskIds.map((id, i) =>
        db
          .update(tasks)
          .set({ sort_order: i * 1000, updated: now })
          .where(and(eq(tasks.id, id), eq(tasks.list_id, listId))),
      ),
    );
    await touchListUpdated(listId, db);
  });
}
