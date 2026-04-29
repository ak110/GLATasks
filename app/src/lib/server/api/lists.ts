/**
 * @fileoverview リスト関連API（CRUD・統合・アーカイブ）
 */

import { and, asc, eq, min } from "drizzle-orm";

import type { ListInfo } from "$lib/types";
import { adjustUpdatedTimestamps, mergeByTimestamp } from "../merge-utils";
import { getDb } from "../db";
import { lists, tasks } from "../schema";
import { toUtcIso, touchListUpdated, getOwnedList } from "./common";

export type { ListInfo };

/** リスト一覧を取得する。タイトル昇順で返す。 */
export async function getLists(
  userId: number,
  showType: string,
): Promise<ListInfo[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(lists)
    .where(eq(lists.user_id, userId))
    .orderBy(asc(lists.title));
  return rows
    .filter((r) => {
      if (showType === "active") return r.status === "active";
      // "archived" と "all" では全リストを表示
      // （アーカイブ表示でアクティブなリスト内のアーカイブ済みタスクも確認できるようにする）
      return true;
    })
    .map((r) => ({
      id: r.id,
      title: r.title,
      sort_order: r.sort_order,
      last_updated: toUtcIso(r.last_updated),
      status: r.status,
    }));
}

/** リストを作成する。sort_order は既存の最小値 - 1000（先頭追加）。 */
export async function postList(userId: number, title: string): Promise<void> {
  if (title.length === 0) throw new Error("タイトルは必須です。");
  const db = getDb();
  // 現在の最小 sort_order を取得
  const [{ minOrder }] = await db
    .select({ minOrder: min(lists.sort_order) })
    .from(lists)
    .where(eq(lists.user_id, userId));
  const sortOrder = (minOrder ?? 1000) - 1000;
  await db.insert(lists).values({
    title,
    user_id: userId,
    status: "active",
    sort_order: sortOrder,
    last_updated: new Date(),
  });
}

/** 完了済みタスクを archived にする。 */
export async function clearList(userId: number, listId: number): Promise<void> {
  await getOwnedList(listId, userId);
  const db = getDb();
  await db
    .update(tasks)
    .set({ status: "archived" })
    .where(and(eq(tasks.list_id, listId), eq(tasks.status, "completed")));
  await touchListUpdated(listId);
}

/** リスト名を変更する。 */
export async function renameList(
  userId: number,
  listId: number,
  title: string,
): Promise<void> {
  if (title.length === 0) throw new Error("タイトルは必須です。");
  await getOwnedList(listId, userId);
  const db = getDb();
  await db.update(lists).set({ title }).where(eq(lists.id, listId));
  await touchListUpdated(listId);
}

/** リストとその全タスクを削除する。 */
export async function deleteList(
  userId: number,
  listId: number,
): Promise<void> {
  // 冪等な削除: 対象が無い・他ユーザーのものは no-op (NOT_FOUND を返さない)。
  // 別端末で先に削除されていた場合のレース時に、こちらの削除がエラーにならず
  // クライアントの状態を確実に整合させるため。
  // schema.ts に ON DELETE CASCADE が無いため、子テーブル (tasks) を明示削除する
  // 既存の 2 段構成は維持する。
  const db = getDb();
  const owned = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.user_id, userId)))
    .limit(1);
  if (owned.length === 0) return;
  await db.delete(tasks).where(eq(tasks.list_id, listId));
  await db.delete(lists).where(eq(lists.id, listId));
}

/** リストを archived にする。 */
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

/**
 * 2つのリストを統合する。
 *
 * source の全タスクを target に移動し、source リストを削除する。
 * 並び順は各リスト内の sort_order を維持しつつ、updated でインターリーブする。
 * sort_order と updated が矛盾する箇所は線形補間で補正する。
 */
export async function mergeLists(
  userId: number,
  sourceListId: number,
  targetListId: number,
): Promise<void> {
  if (sourceListId === targetListId) {
    throw new Error("same_list");
  }
  const sourceList = await getOwnedList(sourceListId, userId);
  const targetList = await getOwnedList(targetListId, userId);
  if (sourceList.status !== "active" || targetList.status !== "active") {
    throw new Error("list_not_active");
  }

  const db = getDb();
  // 両リストの全タスクを sort_order 昇順で取得
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

  // 各リストの updated を sort_order と整合するよう線形補間で補正
  const sourceAdjusted = adjustUpdatedTimestamps(sourceTasks);
  const targetAdjusted = adjustUpdatedTimestamps(targetTasks);

  // マージソートのマージステップで統合（adjusted 降順）
  const merged = mergeByTimestamp(
    targetTasks.map((t, i) => ({ task: t, adjusted: targetAdjusted[i]! })),
    sourceTasks.map((t, i) => ({ task: t, adjusted: sourceAdjusted[i]! })),
  );

  // sort_order を 0, 1000, 2000... で再割り当てし、依存関係のないタスクを並列更新
  await Promise.all(
    merged.map(({ task, adjusted }, i) => {
      const newSortOrder = i * 1000;
      return db
        .update(tasks)
        .set({
          list_id: targetListId,
          sort_order: newSortOrder,
          // 補正された updated のみ DB に反映
          ...(adjusted !== task.updated.getTime() && {
            updated: new Date(adjusted),
          }),
        })
        .where(eq(tasks.id, task.id));
    }),
  );

  // source リストを削除
  await db.delete(lists).where(eq(lists.id, sourceListId));
  // target の last_updated を更新
  await touchListUpdated(targetListId);
}

/** リストを active に戻す。 */
export async function unarchiveList(
  userId: number,
  listId: number,
): Promise<void> {
  await getOwnedList(listId, userId);
  const db = getDb();
  await db.update(lists).set({ status: "active" }).where(eq(lists.id, listId));
}
