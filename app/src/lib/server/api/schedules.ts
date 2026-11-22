import { ApiError } from "../api-errors";

import { and, asc, eq, min } from "drizzle-orm";
import type { z } from "zod";

import type {
  CreateScheduleSchema,
  UpdateScheduleSchema,
} from "../schedule-schemas";
import { getDb } from "../db";
import { lists, schedules } from "../schema";
import { parseTags, serializeTags, toUtcIso, getOwnedList } from "./common";

export type ScheduleInfo = ReturnType<typeof toScheduleInfo>;

type UpdateScheduleData = Omit<
  z.infer<typeof UpdateScheduleSchema>,
  "scheduleId"
>;

function toScheduleInfo(row: typeof schedules.$inferSelect) {
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

async function getOwnedSchedule(scheduleId: number, userId: number) {
  const db = getDb();
  const rows = await db
    .select({ schedule: schedules, list: lists })
    .from(schedules)
    .innerJoin(lists, eq(schedules.list_id, lists.id))
    .where(and(eq(schedules.id, scheduleId), eq(lists.user_id, userId)))
    .limit(1);
  if (rows.length === 0) throw new ApiError("schedule_not_found");
  return rows[0]!.schedule;
}

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

export async function createSchedule(
  userId: number,
  input: z.infer<typeof CreateScheduleSchema>,
): Promise<ScheduleInfo> {
  await getOwnedList(input.listId, userId);
  const db = getDb();
  const now = new Date();
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

export async function deleteSchedule(
  userId: number,
  scheduleId: number,
): Promise<void> {
  const db = getDb();
  const owned = await db
    .select({ id: schedules.id })
    .from(schedules)
    .innerJoin(lists, eq(schedules.list_id, lists.id))
    .where(and(eq(schedules.id, scheduleId), eq(lists.user_id, userId)))
    .limit(1);
  if (owned.length === 0) return;
  await db.delete(schedules).where(eq(schedules.id, owned[0].id));
}
