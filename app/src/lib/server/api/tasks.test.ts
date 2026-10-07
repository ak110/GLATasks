import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";

import {
  cleanupFixtures,
  createFixtureList,
  describeDb,
} from "../db-test-helpers";
import { getDb } from "../db";
import { lists, tasks } from "../schema";
import { getActiveTasks, getListTasks, patchTask, postTask } from "./tasks";

describeDb("タスク更新と差分同期", () => {
  const userIds: number[] = [];
  afterAll(async () => cleanupFixtures(userIds));

  it("部分更新・完了日時・移動を反映し、他の利用者のリストへは移動しない", async () => {
    const source = await createFixtureList();
    const target = await createFixtureList(source.userId);
    const other = await createFixtureList();
    userIds.push(source.userId, other.userId);
    const taskId = await postTask(source.userId, source.listId, "旧題\n注記");
    await patchTask(source.userId, source.listId, taskId, {
      text: "新題\n新注記  ",
      status: "completed",
      kind: "todo",
      tags: [{ name: "確認", color: "red" }],
      keep_order: true,
    });
    const [completed] = await getDb()
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));
    expect(completed).toMatchObject({
      text: "新題\n新注記",
      status: "completed",
      kind: "todo",
    });
    expect(completed.completed).toBeInstanceOf(Date);
    await expect(
      patchTask(source.userId, source.listId, taskId, {
        move_to: other.listId,
        keep_order: true,
      }),
    ).rejects.toThrow("not_found_or_forbidden");
    expect(
      (await getDb().select().from(tasks).where(eq(tasks.id, taskId)))[0]
        .list_id,
    ).toBe(source.listId);
    await patchTask(source.userId, source.listId, taskId, {
      move_to: target.listId,
      completed: null,
      keep_order: true,
    });
    const moved = await getListTasks(source.userId, target.listId, "all");
    expect(moved.status).toBe(200);
    if (moved.status !== 200) throw new Error("移動したタスクが取得できません");
    expect(moved.data).toMatchObject([
      {
        id: taskId,
        title: "新題",
        notes: "新注記",
        tags: [{ name: "確認", color: "red" }],
      },
    ]);
    expect(
      (await getDb().select().from(tasks).where(eq(tasks.id, taskId)))[0]
        .completed,
    ).toBeNull();
    await expect(
      patchTask(source.userId, source.listId, taskId, {
        status: "active",
        keep_order: true,
      }),
    ).rejects.toThrow("task_not_found");
  });

  it("全件はarchivedを除外し、差分は境界同秒のarchivedを含み、他の所有者と非activeリストを除外する", async () => {
    const own = await createFixtureList();
    const archivedList = await createFixtureList(own.userId);
    const other = await createFixtureList();
    userIds.push(own.userId, other.userId);
    const unchanged = await postTask(own.userId, own.listId, "古い更新");
    const changed = await postTask(own.userId, own.listId, "アーカイブ");
    await postTask(own.userId, archivedList.listId, "非activeリスト");
    await postTask(other.userId, other.listId, "他人");
    await getDb()
      .update(lists)
      .set({ status: "archived" })
      .where(eq(lists.id, archivedList.listId));
    const since = new Date("2026-01-02T00:00:00.000Z");
    await getDb()
      .update(tasks)
      .set({ updated: new Date("2026-01-01T00:00:00.000Z") })
      .where(eq(tasks.id, unchanged));
    await getDb()
      .update(tasks)
      .set({ status: "archived", updated: since })
      .where(eq(tasks.id, changed));
    expect(await getActiveTasks(own.userId)).toMatchObject({
      mode: "full",
      tasks: [{ id: unchanged }],
    });
    const delta = await getActiveTasks(own.userId, since);
    expect(delta).toMatchObject({
      mode: "delta",
      tasks: [{ id: changed, status: "archived" }],
    });
    expect(Date.parse(delta.serverTime) % 1000).toBe(0);
    expect(Date.parse(delta.serverTime)).toBeLessThanOrEqual(Date.now() - 1000);
  });
});
