/** DB統合テストで所有する利用者と、その子のfixtureを作成・回収する。 */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { describe } from "vitest";

import { getDb } from "./db";
import {
  attachments,
  calorieAutoRecords,
  calorieItems,
  calorieRecords,
  lists,
  schedules,
  tasks,
  timers,
  users,
} from "./schema";

export const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

export async function createFixtureUser(): Promise<number> {
  const [{ id }] = await getDb()
    .insert(users)
    .values({
      user: `test${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      pass_hash: "dummy",
      joined: new Date(),
    })
    .$returningId();
  return id;
}

export async function createFixtureList(userId?: number) {
  const ownerId = userId ?? (await createFixtureUser());
  const [{ id: listId }] = await getDb()
    .insert(lists)
    .values({
      user_id: ownerId,
      title: "DB試験用リスト",
      last_updated: new Date(),
    })
    .$returningId();
  return { userId: ownerId, listId };
}

export async function createFixtureTask(userId?: number) {
  const fixture = await createFixtureList(userId);
  const now = new Date();
  const [{ id: taskId }] = await getDb()
    .insert(tasks)
    .values({
      list_id: fixture.listId,
      text: "DB試験用タスク",
      created: now,
      updated: now,
    })
    .$returningId();
  return { ...fixture, taskId };
}

/** `cleanupFixtures`の試験用の差し込み口。回収の競合を決定的に再現する試験だけが使う。 */
export type CleanupFixturesOptions = {
  /** 回収transactionの分離レベル。既定はREAD COMMITTED。 */
  isolationLevel?: "read committed" | "repeatable read";
  /** 最初の読み取り（読み取りビューの作成）の直後に呼ぶ処理。 */
  afterFirstRead?: () => Promise<void>;
};

/**
 * 所有する利用者と、その子のfixtureを回収する。
 *
 * 回収transactionはREAD COMMITTEDで実行する。
 * MariaDBの`innodb_snapshot_isolation=ON`とREPEATABLE READでは、最初の読み取りで作った読み取りビューの後に
 * 別の接続が削除対象の行を更新すると、その行の削除が`ER_CHECKREAD`（1020）で失敗する。
 * 定期処理（`processSchedules`）は全リストの有効な予定を走査して更新するため、別の試験の実行がfixtureの予定を更新しうる。
 * 回収は固定のuserIdの行を消すだけで読み取りビューの一貫性を必要としないため、文ごとに最新の行を読む分離レベルを使う。
 */
export async function cleanupFixtures(
  userIds: number[],
  options: CleanupFixturesOptions = {},
): Promise<void> {
  if (userIds.length === 0) return;
  await getDb().transaction(
    async (tx) => {
      const listRows = await tx
        .select({ id: lists.id })
        .from(lists)
        .where(inArray(lists.user_id, userIds));
      await options.afterFirstRead?.();
      const listIds = listRows.map((row) => row.id);
      if (listIds.length > 0) {
        const taskRows = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(inArray(tasks.list_id, listIds));
        const taskIds = taskRows.map((row) => row.id);
        if (taskIds.length > 0) {
          await tx
            .delete(attachments)
            .where(inArray(attachments.task_id, taskIds));
          await tx.delete(tasks).where(inArray(tasks.id, taskIds));
        }
        await tx.delete(schedules).where(inArray(schedules.list_id, listIds));
        await tx.delete(lists).where(inArray(lists.id, listIds));
      }
      await tx.delete(timers).where(inArray(timers.user_id, userIds));
      await tx
        .delete(calorieAutoRecords)
        .where(inArray(calorieAutoRecords.user_id, userIds));
      await tx
        .delete(calorieRecords)
        .where(inArray(calorieRecords.user_id, userIds));
      await tx
        .delete(calorieItems)
        .where(inArray(calorieItems.user_id, userIds));
      await tx.delete(users).where(inArray(users.id, userIds));
    },
    { isolationLevel: options.isolationLevel ?? "read committed" },
  );
}
