import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";

import {
  cleanupFixtures,
  createFixtureList,
  describeDb,
} from "../db-test-helpers";
import { getDb } from "../db";
import { lists, tasks } from "../schema";
import {
  archiveTagCandidates,
  listActiveTasks,
  listTasks,
  listTaskPage,
  searchTaskPage,
  reorderArchivePage,
  updateTask,
  createTask,
} from "./tasks";

describeDb("タスク更新と差分同期", () => {
  const userIds: number[] = [];
  afterAll(async () => cleanupFixtures(userIds));

  it("部分更新・完了日時・移動を反映し、他の利用者のリストへは移動しない", async () => {
    const source = await createFixtureList();
    const target = await createFixtureList(source.userId);
    const other = await createFixtureList();
    userIds.push(source.userId, other.userId);
    const taskId = await createTask(source.userId, source.listId, "旧題\n注記");
    await updateTask(source.userId, source.listId, taskId, {
      text: "新題\n新注記  ",
      status: "completed",
      kind: "todo",
      tags: [{ name: "確認", color: "red" }],
      keepOrder: true,
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
      updateTask(source.userId, source.listId, taskId, {
        moveTo: other.listId,
        keepOrder: true,
      }),
    ).rejects.toThrow("not_found_or_forbidden");
    expect(
      (await getDb().select().from(tasks).where(eq(tasks.id, taskId)))[0]
        .list_id,
    ).toBe(source.listId);
    await updateTask(source.userId, source.listId, taskId, {
      moveTo: target.listId,
      completed: null,
      keepOrder: true,
    });
    const moved = await listTasks(source.userId, target.listId, "all");
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
      updateTask(source.userId, source.listId, taskId, {
        status: "active",
        keepOrder: true,
      }),
    ).rejects.toThrow("task_not_found");
  });

  it("全件はarchivedを除外し、差分は境界同秒のarchivedを含み、他の所有者と非activeリストを除外する", async () => {
    const own = await createFixtureList();
    const archivedList = await createFixtureList(own.userId);
    const other = await createFixtureList();
    userIds.push(own.userId, other.userId);
    const unchanged = await createTask(own.userId, own.listId, "古い更新");
    const changed = await createTask(own.userId, own.listId, "アーカイブ");
    await createTask(own.userId, archivedList.listId, "非activeリスト");
    await createTask(other.userId, other.listId, "他人");
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
    expect(await listActiveTasks(own.userId)).toMatchObject({
      mode: "full",
      tasks: [{ id: unchanged }],
    });
    const delta = await listActiveTasks(own.userId, since);
    expect(delta).toMatchObject({
      mode: "delta",
      tasks: [{ id: changed, status: "archived" }],
    });
    expect(Date.parse(delta.serverTime) % 1000).toBe(0);
    expect(Date.parse(delta.serverTime)).toBeLessThanOrEqual(Date.now() - 1000);
  });
});

describeDb("アーカイブと検索のページ取得", () => {
  const owners: number[] = [];
  afterAll(async () => cleanupFixtures(owners));

  it("同順位の境界を欠落なく巡回し、検索のグループ順と所有権を保つ", async () => {
    const first = await createFixtureList();
    owners.push(first.userId);
    const selected = await createFixtureList(first.userId);
    const other = await createFixtureList();
    owners.push(other.userId);
    const now = new Date();
    const insert = (listId: number, length: number, order: number) =>
      getDb()
        .insert(tasks)
        .values(
          Array.from({ length }, (_, i) => ({
            list_id: listId,
            text: `ページ検索_% ${i}`,
            status: "archived" as const,
            tags: i === length - 1 ? '[{"name":"末尾","color":"red"}]' : "[]",
            sort_order: order,
            created: now,
            updated: now,
          })),
        )
        .$returningId();
    const firstRows = await insert(first.listId, 53, 0);
    const selectedRows = await insert(selected.listId, 52, 1);
    await insert(other.listId, 2, -1);
    await createTask(first.userId, first.listId, "ページ検索_% 非アーカイブ");
    const ids = (result: { tasks: { id: number }[] }) =>
      result.tasks.map(({ id }) => id);
    const archive = (page: number) =>
      listTaskPage(first.userId, first.listId, page);
    const search = (page: number, listId: number | null = selected.listId) =>
      searchTaskPage(first.userId, "ページ検索_%", "archived", listId, page);

    const archivePages = await Promise.all([
      archive(0),
      archive(1),
      archive(2),
    ]);
    expect(archivePages.map(({ total, hasNext }) => [total, hasNext])).toEqual([
      [53, true],
      [53, false],
      [53, false],
    ]);
    expect(archivePages.flatMap(ids)).toEqual(firstRows.map(({ id }) => id));
    await expect(listTaskPage(first.userId, other.listId, 0)).rejects.toThrow(
      "not_found_or_forbidden",
    );
    await expect(
      archiveTagCandidates(first.userId, first.listId),
    ).resolves.toEqual([{ name: "末尾", color: "red" }]);

    const searchPages = await Promise.all([search(0), search(1), search(2)]);
    expect(searchPages.map(({ total }) => total)).toEqual([105, 105, 105]);
    expect(searchPages.flatMap(ids)).toEqual(
      [...selectedRows, ...firstRows].map(({ id }) => id),
    );
    expect(ids(await search(0, other.listId))).toEqual(
      firstRows.slice(0, 50).map(({ id }) => id),
    );
    expect(
      (await searchTaskPage(first.userId, "ページ検索_%", "active", null, 0))
        .total,
    ).toBe(1);

    const original = firstRows.map(({ id }) => id);
    const reorder = (
      page: number,
      change: Parameters<typeof reorderArchivePage>[1]["change"],
    ) =>
      reorderArchivePage(first.userId, { listId: first.listId, page, change });
    const readAll = async () => [
      ...ids(await archive(0)),
      ...ids(await archive(1)),
    ];
    await reorder(1, {
      kind: "reorder",
      taskIds: original.slice(50).reverse(),
    });
    expect(await readAll()).toEqual([
      ...original.slice(0, 50),
      ...original.slice(50).reverse(),
    ]);
    const moved = original[52];
    const expected = (await readAll()).filter((id) => id !== moved);
    await reorder(1, { kind: "previous", taskId: moved });
    expect(await readAll()).toEqual([
      ...expected.slice(0, 49),
      moved,
      ...expected.slice(49),
    ]);
    await reorder(0, { kind: "next", taskId: moved });
    expect(await readAll()).toEqual([
      ...expected.slice(0, 50),
      moved,
      ...expected.slice(50),
    ]);
  });
});
