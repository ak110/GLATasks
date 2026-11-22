import { ApiError } from "../api-errors";
/**
 * @fileoverview タスク関連API（取得・追加・更新・検索・並び替え）
 */

import {
  and,
  asc,
  count,
  sql,
  eq,
  gte,
  inArray,
  like,
  lt,
  min,
  ne,
  or,
} from "drizzle-orm";
import type { z } from "zod";

import type {
  ShowType,
  TagInfo,
  TaskKind,
  TaskStatus,
  UpdateTaskSchema,
  ReorderArchivePageSchema,
} from "#lib/schemas.ts";
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
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.list_id, listId), taskStatusFilter(showType)))
    .orderBy(asc(tasks.sort_order), asc(tasks.id));
  const data = await convertTasks(rows);

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
    if (taskRows.length === 0) throw new ApiError("task_not_found");
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

const TASK_PAGE_SIZE = 50;

function taskStatusFilter(showType: ShowType) {
  if (showType === "all") return undefined;
  return showType === "archived"
    ? eq(tasks.status, "archived")
    : ne(tasks.status, "archived");
}

function matchingTaskFilter(query: string, showType: ShowType) {
  const pattern = `%${query.replace(/[%_]/g, "\\$&")}%`;
  return and(taskStatusFilter(showType), like(tasks.text, pattern));
}

function searchFilter(userId: number, query: string, showType: ShowType) {
  return and(
    eq(lists.user_id, userId),
    showType === "active" ? eq(lists.status, "active") : undefined,
    matchingTaskFilter(query, showType),
  );
}

async function convertTasks<T extends typeof tasks.$inferSelect>(
  rows: T[],
  db?: DbConnection,
) {
  const attachments = await listAttachmentsForTasks(
    rows.map((row) => row.id),
    db,
  );
  return rows.map((row) => toTaskInfo(row, attachments));
}

function pageResult<T>(rows: T[], page: number, total: number) {
  return {
    tasks: rows,
    page,
    pageSize: TASK_PAGE_SIZE,
    total,
    hasPrevious: page > 0,
    hasNext: (page + 1) * TASK_PAGE_SIZE < total,
  };
}

export async function listTaskPage(
  userId: number,
  listId: number,
  page: number,
) {
  return getDb().transaction(async (db) => {
    await getOwnedList(listId, userId, db);
    const filter = and(eq(tasks.list_id, listId), taskStatusFilter("archived"));
    const [{ total }] = await db
      .select({ total: count() })
      .from(tasks)
      .where(filter);
    const rows = await db
      .select()
      .from(tasks)
      .where(filter)
      .orderBy(asc(tasks.sort_order), asc(tasks.id))
      .limit(TASK_PAGE_SIZE)
      .offset(page * TASK_PAGE_SIZE);
    return pageResult(await convertTasks(rows, db), page, total);
  });
}

/** 対象がアーカイブ済みでなくなっていれば、一覧の先頭として0ページ目を返す。 */
export async function findArchivePage(
  userId: number,
  listId: number,
  taskId: number,
) {
  return getDb().transaction(async (db) => {
    await getOwnedList(listId, userId, db);
    const filter = and(eq(tasks.list_id, listId), taskStatusFilter("archived"));
    const [target] = await db
      .select({ sortOrder: tasks.sort_order })
      .from(tasks)
      .where(and(filter, eq(tasks.id, taskId)));
    if (!target) return { page: 0 };
    const [{ before }] = await db
      .select({ before: count() })
      .from(tasks)
      .where(
        and(
          filter,
          or(
            lt(tasks.sort_order, target.sortOrder),
            and(eq(tasks.sort_order, target.sortOrder), lt(tasks.id, taskId)),
          ),
        ),
      );
    return { page: Math.floor(before / TASK_PAGE_SIZE) };
  });
}

export async function archiveTagCandidates(userId: number, listId: number) {
  const db = getDb();
  await getOwnedList(listId, userId, db);
  const rows = await db
    .select({ tags: tasks.tags })
    .from(tasks)
    .where(
      and(
        eq(tasks.list_id, listId),
        taskStatusFilter("archived"),
        ne(tasks.tags, "[]"),
      ),
    )
    .orderBy(asc(tasks.sort_order), asc(tasks.id));
  const tags = new Map<string, TagInfo>();
  for (const row of rows) {
    for (const tag of parseTags(row.tags)) {
      if (!tags.has(tag.name)) tags.set(tag.name, tag);
    }
  }
  return [...tags.values()];
}

async function convertSearchRows(
  rows: { task: typeof tasks.$inferSelect; listTitle: string }[],
  db?: DbConnection,
) {
  const data = await convertTasks(
    rows.map(({ task }) => task),
    db,
  );
  return data.map((task, i) => ({
    ...task,
    listId: rows[i].task.list_id,
    listTitle: rows[i].listTitle,
  }));
}

/** 全リスト横断でタスクを LIKE 検索する */
export async function searchTasks(
  userId: number,
  query: string,
  showType: ShowType,
) {
  const rows = await getDb()
    .select({ task: tasks, listTitle: lists.title })
    .from(tasks)
    .innerJoin(lists, eq(tasks.list_id, lists.id))
    .where(searchFilter(userId, query, showType))
    .orderBy(asc(tasks.sort_order), asc(tasks.id));
  return convertSearchRows(rows);
}

export async function searchTaskPage(
  userId: number,
  query: string,
  showType: ShowType,
  selectedListId: number | null,
  page: number,
) {
  return getDb().transaction(async (db) => {
    const filter = searchFilter(userId, query, showType);
    const [{ total }] = await db
      .select({ total: count() })
      .from(tasks)
      .innerJoin(lists, eq(tasks.list_id, lists.id))
      .where(filter);
    // 一致タスクごとにウィンドウ関数を評価せず、リスト単位の最小順位を再利用する。
    const groups = db
      .select({
        listId: tasks.list_id,
        firstOrder: min(tasks.sort_order).as("first_order"),
      })
      .from(tasks)
      .innerJoin(lists, eq(tasks.list_id, lists.id))
      .where(filter)
      .groupBy(tasks.list_id)
      .as("matched_lists");
    const matches = await db
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(groups, eq(tasks.list_id, groups.listId))
      .where(matchingTaskFilter(query, showType))
      .orderBy(
        sql`case when ${tasks.list_id} = ${selectedListId} then 0 else 1 end`,
        asc(groups.firstOrder),
        asc(tasks.list_id),
        asc(tasks.sort_order),
        asc(tasks.id),
      )
      .limit(TASK_PAGE_SIZE)
      .offset(page * TASK_PAGE_SIZE);
    if (matches.length === 0) return pageResult([], page, total);

    const rows = await db
      .select({ task: tasks, listTitle: lists.title })
      .from(tasks)
      .innerJoin(lists, eq(tasks.list_id, lists.id))
      .where(
        inArray(
          tasks.id,
          matches.map(({ id }) => id),
        ),
      );
    const byId = new Map(rows.map((row) => [row.task.id, row]));
    return pageResult(
      await convertSearchRows(
        matches.map(({ id }) => byId.get(id)!),
        db,
      ),
      page,
      total,
    );
  });
}

export function planArchivePageReorder(
  rows: ReadonlyArray<{ id: number; order: number; status: TaskStatus }>,
  page: number,
  change: z.infer<typeof ReorderArchivePageSchema>["change"],
  pageSize = TASK_PAGE_SIZE,
): Array<{ id: number; order: number }> {
  const archive = rows.filter((row) => row.status === "archived");
  const offset = page * pageSize;
  const current = archive.slice(offset, offset + pageSize);
  const ordered = [...rows];
  if (change.kind === "reorder") {
    const byId = new Map(current.map((row) => [row.id, row]));
    if (
      byId.size !== change.taskIds.length ||
      new Set(change.taskIds).size !== byId.size ||
      change.taskIds.some((id) => !byId.has(id))
    )
      throw new ApiError("task_not_found");
    const positions = current.map((row) => rows.indexOf(row));
    positions.forEach((position, i) => {
      ordered[position] = byId.get(change.taskIds[i])!;
    });
  } else {
    const moved = current.find((row) => row.id === change.taskId);
    const neighbor =
      archive[change.kind === "previous" ? offset - 1 : offset + pageSize];
    if (!moved || !neighbor) throw new ApiError("task_not_found");
    ordered.splice(ordered.indexOf(moved), 1);
    ordered.splice(
      ordered.indexOf(neighbor) + (change.kind === "next" ? 1 : 0),
      0,
      moved,
    );

    const destination = ordered.indexOf(moved);
    const lower = ordered[destination - 1]?.order ?? -2147483649;
    const upper = ordered[destination + 1]?.order ?? 2147483648;
    if (upper - lower > 1) {
      return [{ id: moved.id, order: Math.floor((lower + upper) / 2) }];
    }
  }

  // 同値の中でID順が逆転する場合だけ振り直し、ページ外の相対順も保つ。
  const needsRenumber =
    change.kind !== "reorder" ||
    ordered.some(
      (row, i) =>
        i > 0 &&
        rows[i - 1].order === rows[i].order &&
        ordered[i - 1].id > row.id,
    );
  return ordered.flatMap((row, i) => {
    const order = needsRenumber ? i : rows[i].order;
    return row.order === order ? [] : [{ id: row.id, order }];
  });
}

export async function reorderArchivePage(
  userId: number,
  { listId, page, change }: z.infer<typeof ReorderArchivePageSchema>,
) {
  // 所有権確認の読み取りビューを次のロック取得へ持ち越さない。
  await getDb().transaction(
    async (db) => {
      await getOwnedList(listId, userId, db);
      const rows = await db
        .select({ id: tasks.id, order: tasks.sort_order, status: tasks.status })
        .from(tasks)
        .where(eq(tasks.list_id, listId))
        .orderBy(asc(tasks.sort_order), asc(tasks.id))
        .for("update");
      const now = new Date();
      for (const { id, order } of planArchivePageReorder(rows, page, change)) {
        await db
          .update(tasks)
          .set({ sort_order: order, updated: now })
          .where(eq(tasks.id, id));
      }
      await touchListUpdated(listId, db);
    },
    { isolationLevel: "read committed" },
  );
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
