import { afterAll, expect, it } from "vitest";
import {
  cleanupFixtures,
  createFixtureList,
  describeDb,
} from "../db-test-helpers";
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  updateSchedule,
} from "./schedules";

describeDb("定期TODOのCRUDと所有権", () => {
  const userIds: number[] = [];
  afterAll(async () => cleanupFixtures(userIds));
  it("登録・部分更新・削除を反映し、他の所有者の取得と更新を拒否する", async () => {
    const own = await createFixtureList();
    const other = await createFixtureList();
    userIds.push(own.userId, other.userId);
    const rrule = "DTSTART;TZID=Asia/Tokyo:20260101T090000\nRRULE:FREQ=DAILY";
    const created = await createSchedule(own.userId, {
      listId: own.listId,
      title: "登録",
      rrule,
      tags: [{ name: "家事", color: "blue" }],
    });
    expect(created).toMatchObject({
      listId: own.listId,
      title: "登録",
      rrule,
      enabled: true,
    });
    await expect(listSchedules(other.userId, own.listId)).rejects.toThrow(
      "not_found_or_forbidden",
    );
    await expect(
      updateSchedule(other.userId, created.id, { title: "不正" }),
    ).rejects.toThrow("schedule_not_found");
    const updated = await updateSchedule(own.userId, created.id, {
      title: "更新",
      enabled: false,
    });
    expect(updated).toMatchObject({
      title: "更新",
      enabled: false,
      rrule,
      tags: [{ name: "家事", color: "blue" }],
    });
    expect(await listSchedules(own.userId, own.listId)).toEqual([updated]);
    await expect(
      deleteSchedule(other.userId, created.id),
    ).resolves.toBeUndefined();
    expect(await listSchedules(own.userId, own.listId)).toEqual([updated]);
    await deleteSchedule(own.userId, created.id);
    expect(await listSchedules(own.userId, own.listId)).toEqual([]);
    await expect(
      deleteSchedule(own.userId, created.id),
    ).resolves.toBeUndefined();
    expect(await listSchedules(own.userId, own.listId)).toEqual([]);
    await expect(
      updateSchedule(own.userId, created.id, { enabled: true }),
    ).rejects.toThrow("schedule_not_found");
  });
});
