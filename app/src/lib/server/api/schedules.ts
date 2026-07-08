/**
 * @fileoverview 定期TODOスケジュール関連API（一覧・作成・更新・削除）
 *
 * ユーザー操作起点のCRUDに限定する。発火処理（スケジュール評価・タスク生成・
 * last_fired更新）は `../scheduler.ts` へ分離する。
 */

import { and, asc, eq, min } from "drizzle-orm";
import type { z } from "zod";

import type {
  CreateScheduleSchema,
  UpdateScheduleSchema,
} from "../schedule-schemas";
import type { ScheduleInfo } from "$lib/types";
import { getDb } from "../db";
import { lists, schedules } from "../schema";
import { parseTags, serializeTags, toUtcIso, getOwnedList } from "./common";

export type { ScheduleInfo };

/** updateSchedule の data 引数型（UpdateScheduleSchema から scheduleId を除いた型） */
type UpdateScheduleData = Omit<
  z.infer<typeof UpdateScheduleSchema>,
  "scheduleId"
>;

/** DB の schedule 行を ScheduleInfo に変換する */
function toScheduleInfo(row: typeof schedules.$inferSelect): ScheduleInfo {
  return {
    id: row.id,
    listId: row.list_id,
    title: row.title,
    tags: parseTags(row.tags),
    rrule: row.rrule,
    lastFired: row.last_fired ? toUtcIso(row.last_fired) : null,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
  };
}

/** スケジュールの所有権チェック（list 経由）。 */
async function getOwnedSchedule(scheduleId: number, userId: number) {
  const db = getDb();
  const rows = await db
    .select({ schedule: schedules, list: lists })
    .from(schedules)
    .innerJoin(lists, eq(schedules.list_id, lists.id))
    .where(and(eq(schedules.id, scheduleId), eq(lists.user_id, userId)))
    .limit(1);
  if (rows.length === 0) throw new Error("schedule_not_found");
  return rows[0]!.schedule;
}

/** 指定リストのスケジュール一覧を取得する */
export async function listSchedules(
  userId: number,
  listId: number,
): Promise<ScheduleInfo[]> {
  await getOwnedList(listId, userId);
  const db = getDb();
  const rows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.list_id, listId))
    .orderBy(asc(schedules.sort_order));
  return rows.map(toScheduleInfo);
}

/** スケジュールを作成する */
export async function createSchedule(
  userId: number,
  input: z.infer<typeof CreateScheduleSchema>,
): Promise<ScheduleInfo> {
  await getOwnedList(input.listId, userId);
  const db = getDb();
  const now = new Date();
  // 既存 postList/postTask と同じく、既存最小値 - 1000 で先頭配置する
  // （既存 schedule が無い場合は 0）
  const [{ minOrder }] = await db
    .select({ minOrder: min(schedules.sort_order) })
    .from(schedules)
    .where(eq(schedules.list_id, input.listId));
  const sortOrder = minOrder === null ? 0 : minOrder - 1000;
  const result = await db
    .insert(schedules)
    .values({
      list_id: input.listId,
      title: input.title,
      tags: serializeTags(input.tags ?? []),
      rrule: input.rrule,
      enabled: 1,
      sort_order: sortOrder,
      created: now,
      updated: now,
    })
    .$returningId();
  const rows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, result[0]!.id))
    .limit(1);
  return toScheduleInfo(rows[0]!);
}

/** スケジュールを更新する（部分更新） */
export async function updateSchedule(
  userId: number,
  scheduleId: number,
  data: UpdateScheduleData,
): Promise<ScheduleInfo> {
  await getOwnedSchedule(scheduleId, userId);
  const db = getDb();
  const updates: Partial<typeof schedules.$inferInsert> = {
    updated: new Date(),
  };
  if (data.title !== undefined) updates.title = data.title;
  if (data.tags !== undefined) updates.tags = serializeTags(data.tags);
  if (data.rrule !== undefined) updates.rrule = data.rrule;
  if (data.enabled !== undefined) updates.enabled = data.enabled ? 1 : 0;

  await db.update(schedules).set(updates).where(eq(schedules.id, scheduleId));
  const rows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);
  return toScheduleInfo(rows[0]!);
}

/** スケジュールを削除する */
export async function deleteSchedule(
  userId: number,
  scheduleId: number,
): Promise<void> {
  await getOwnedSchedule(scheduleId, userId);
  const db = getDb();
  await db.delete(schedules).where(eq(schedules.id, scheduleId));
}
