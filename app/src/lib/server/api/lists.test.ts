import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";

import {
  cleanupFixtures,
  createFixtureTask,
  createFixtureList,
  describeDb,
} from "../db-test-helpers";
import { getDb } from "../db";
import { attachments, lists, schedules, tasks } from "../schema";
import { createAttachment, downloadAttachment } from "./attachments";
import { createSchedule, listSchedules } from "./schedules";
import { deleteList, mergeLists } from "./lists";
import { createTask } from "./tasks";

const rrule = "DTSTART;TZID=Asia/Tokyo:20260101T090000\nRRULE:FREQ=DAILY";

describeDb("リストの削除と統合", () => {
  const userIds: number[] = [];
  afterAll(async () => cleanupFixtures(userIds));

  it("RESTRICTの下で添付・タスク・定期TODOを先に削除し、他の所有者の削除と再削除は何もしない", async () => {
    const own = await createFixtureTask();
    const other = await createFixtureList();
    userIds.push(own.userId, other.userId);
    const { attachmentId } = await createAttachment({
      userId: own.userId,
      taskId: own.taskId,
      filename: "保持.txt",
      mimeType: "text/plain",
      data: Buffer.from("内容").toString("base64"),
    });
    const schedule = await createSchedule(own.userId, {
      listId: own.listId,
      title: "定期",
      rrule,
    });
    await deleteList(other.userId, own.listId);
    expect(
      await downloadAttachment({ userId: own.userId, attachmentId }),
    ).toMatchObject({ filename: "保持.txt" });
    await deleteList(own.userId, own.listId);
    await deleteList(own.userId, own.listId);
    for (const [table, id] of [
      [lists, own.listId],
      [tasks, own.taskId],
      [attachments, attachmentId],
      [schedules, schedule.id],
    ] as const) {
      expect(
        await getDb()
          .select({ id: table.id })
          .from(table)
          .where(eq(table.id, id)),
      ).toHaveLength(0);
    }
  });

  it("updated順で統合し、添付のtask参照と定期TODOを移動先へ保つ", async () => {
    const source = await createFixtureTask();
    const target = await createFixtureList(source.userId);
    userIds.push(source.userId);
    const targetTask = await createTask(source.userId, target.listId, "移動先");
    const { attachmentId } = await createAttachment({
      userId: source.userId,
      taskId: source.taskId,
      filename: "統合.txt",
      mimeType: "text/plain",
      data: "eA==",
    });
    const schedule = await createSchedule(source.userId, {
      listId: source.listId,
      title: "移動する定期",
      rrule,
    });
    await getDb()
      .update(tasks)
      .set({ updated: new Date("2026-01-02T00:00:00Z") })
      .where(eq(tasks.id, source.taskId));
    await getDb()
      .update(tasks)
      .set({ updated: new Date("2026-01-01T00:00:00Z") })
      .where(eq(tasks.id, targetTask));
    await mergeLists(source.userId, source.listId, target.listId);
    const rows = await getDb()
      .select()
      .from(tasks)
      .where(inArray(tasks.id, [source.taskId, targetTask]))
      .orderBy(tasks.sort_order);
    expect(rows.map((row) => [row.id, row.list_id, row.sort_order])).toEqual([
      [source.taskId, target.listId, 0],
      [targetTask, target.listId, 1000],
    ]);
    expect(
      await getDb().select().from(lists).where(eq(lists.id, source.listId)),
    ).toHaveLength(0);
    expect(await listSchedules(source.userId, target.listId)).toMatchObject([
      { id: schedule.id, listId: target.listId },
    ]);
    expect(
      await downloadAttachment({ userId: source.userId, attachmentId }),
    ).toMatchObject({ filename: "統合.txt" });
    await expect(
      mergeLists(source.userId, target.listId, target.listId),
    ).rejects.toThrow("same_list");
    await getDb()
      .update(lists)
      .set({ status: "archived" })
      .where(eq(lists.id, target.listId));
    const newSource = await createFixtureList(source.userId);
    await expect(
      mergeLists(source.userId, newSource.listId, target.listId),
    ).rejects.toThrow("list_not_active");
    expect(
      await getDb().select().from(lists).where(eq(lists.id, newSource.listId)),
    ).toHaveLength(1);
  });

  it("統合末尾の削除が失敗すると、タスク・定期TODO・リストの更新を全て戻す", async () => {
    const source = await createFixtureTask();
    const target = await createFixtureList(source.userId);
    userIds.push(source.userId);
    await createTask(source.userId, target.listId, "移動先");
    await createSchedule(source.userId, {
      listId: source.listId,
      title: "定期",
      rrule,
    });
    const db = getDb();
    const originalTasks = await db
      .select()
      .from(tasks)
      .where(inArray(tasks.list_id, [source.listId, target.listId]))
      .orderBy(tasks.id);
    const originalSchedules = await listSchedules(source.userId, source.listId);
    const originalLists = await db
      .select()
      .from(lists)
      .where(inArray(lists.id, [source.listId, target.listId]))
      .orderBy(lists.id);
    // 試験専用の外部キーで最後のDELETEを失敗させ、先行する書き込みのrollbackを観測する。
    const blocker = sql.identifier(
      `test_merge_${randomUUID().replaceAll("-", "")}`,
    );
    await db.execute(
      sql`CREATE TABLE ${blocker} (list_id int NOT NULL, FOREIGN KEY (list_id) REFERENCES ${lists} (id) ON DELETE RESTRICT)`,
    );
    try {
      await db.execute(
        sql`INSERT INTO ${blocker} (list_id) VALUES (${source.listId})`,
      );
      await expect(
        mergeLists(source.userId, source.listId, target.listId),
      ).rejects.toThrow();
      expect(
        await db
          .select()
          .from(tasks)
          .where(inArray(tasks.list_id, [source.listId, target.listId]))
          .orderBy(tasks.id),
      ).toEqual(originalTasks);
      expect(await listSchedules(source.userId, source.listId)).toEqual(
        originalSchedules,
      );
      expect(
        await db
          .select()
          .from(lists)
          .where(inArray(lists.id, [source.listId, target.listId]))
          .orderBy(lists.id),
      ).toEqual(originalLists);
    } finally {
      await db.execute(sql`DROP TABLE ${blocker}`);
    }
  });
});
