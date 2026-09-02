/**
 * @fileoverview カロリー計算API
 */

import { and, desc, eq, gte, lt, lte } from "drizzle-orm";

import {
  DEFAULT_CALORIE_GOAL_KCAL,
  type CalorieItemCsvRow,
  type CalorieItemInput,
  type CalorieRecordCsvRow,
  type CalorieRecordInput,
  type ListCalorieRecordsInput,
  type UpdateCalorieItemInput,
  type UpdateCalorieRecordInput,
} from "$lib/schemas";
import { getDb } from "../db";
import { calorieItems, calorieRecords } from "../schema";
import { getUserPreferences } from "./users";

const DAY_MS = 24 * 60 * 60 * 1000;

export type CalorieItem = {
  id: number;
  name: string;
  kcal: number;
  note: string;
};

export type CalorieRecord = {
  id: number;
  item_id: number;
  item_name: string;
  item_kcal: number;
  consumed_at: string;
  quantity: number;
  total_kcal: number;
};

function localMinuteToUtc(value: string, offsetMinutes: number): Date {
  const [datePart, timePart] = value.split(" ");
  const [year, month, day] = datePart.split("/").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60_000,
  );
}

function calculateWindow(
  windowOffset: number,
  offsetMinutes: number,
  now: Date,
): { start: Date; endExclusive: Date } {
  const localNow = new Date(now.getTime() + offsetMinutes * 60_000);
  const localTomorrow = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate() + 1,
  );
  const endExclusive = new Date(
    localTomorrow - offsetMinutes * 60_000 - windowOffset * 30 * DAY_MS,
  );
  return {
    start: new Date(endExclusive.getTime() - 30 * DAY_MS),
    endExclusive,
  };
}

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

async function assertOwnedItem(userId: number, itemId: number): Promise<void> {
  const rows = await getDb()
    .select({ id: calorieItems.id })
    .from(calorieItems)
    .where(and(eq(calorieItems.id, itemId), eq(calorieItems.user_id, userId)))
    .limit(1);
  if (rows.length === 0) throw new Error("calorie_item_not_found");
}

export async function getCalorieItems(userId: number): Promise<CalorieItem[]> {
  const rows = await getDb()
    .select({
      id: calorieItems.id,
      name: calorieItems.name,
      kcal: calorieItems.kcal,
      note: calorieItems.note,
    })
    .from(calorieItems)
    .where(eq(calorieItems.user_id, userId))
    .orderBy(calorieItems.name);
  return rows;
}

export async function createCalorieItem(
  userId: number,
  input: CalorieItemInput,
): Promise<void> {
  const now = new Date();
  try {
    await getDb().insert(calorieItems).values({
      user_id: userId,
      name: input.name,
      kcal: input.kcal,
      note: input.note,
      created: now,
      updated: now,
    });
  } catch (error) {
    if (isDuplicateEntry(error)) {
      throw new Error("calorie_item_name_conflict", { cause: error });
    }
    throw error;
  }
}

export async function updateCalorieItem(
  userId: number,
  input: UpdateCalorieItemInput,
): Promise<void> {
  await assertOwnedItem(userId, input.itemId);
  try {
    await getDb()
      .update(calorieItems)
      .set({
        name: input.name,
        kcal: input.kcal,
        note: input.note,
        updated: new Date(),
      })
      .where(
        and(
          eq(calorieItems.id, input.itemId),
          eq(calorieItems.user_id, userId),
        ),
      );
  } catch (error) {
    if (isDuplicateEntry(error)) {
      throw new Error("calorie_item_name_conflict", { cause: error });
    }
    throw error;
  }
}

async function selectRecords(
  userId: number,
  range?: { start: Date; endExclusive: Date },
): Promise<CalorieRecord[]> {
  const rangeCondition = range
    ? and(
        gte(calorieRecords.consumed_at, range.start),
        lt(calorieRecords.consumed_at, range.endExclusive),
      )
    : undefined;
  const rows = await getDb()
    .select({
      id: calorieRecords.id,
      item_id: calorieRecords.item_id,
      item_name: calorieItems.name,
      item_kcal: calorieItems.kcal,
      consumed_at: calorieRecords.consumed_at,
      quantity: calorieRecords.quantity,
    })
    .from(calorieRecords)
    .innerJoin(
      calorieItems,
      and(
        eq(calorieItems.id, calorieRecords.item_id),
        eq(calorieItems.user_id, userId),
      ),
    )
    .where(and(eq(calorieRecords.user_id, userId), rangeCondition))
    .orderBy(desc(calorieRecords.consumed_at), desc(calorieRecords.id));
  return rows.map((row) => ({
    ...row,
    consumed_at: row.consumed_at.toISOString(),
    total_kcal: row.item_kcal * row.quantity,
  }));
}

export async function getCalorieRecords(
  userId: number,
  input: ListCalorieRecordsInput,
  now = new Date(),
): Promise<{ records: CalorieRecord[]; window_offset: number }> {
  const range = calculateWindow(
    input.window_offset,
    input.tz_offset_minutes,
    now,
  );
  return {
    records: await selectRecords(userId, range),
    window_offset: input.window_offset,
  };
}

export async function getAllCalorieRecords(
  userId: number,
): Promise<CalorieRecord[]> {
  return selectRecords(userId);
}

export async function createCalorieRecord(
  userId: number,
  input: CalorieRecordInput,
): Promise<void> {
  await assertOwnedItem(userId, input.item_id);
  const now = new Date();
  await getDb()
    .insert(calorieRecords)
    .values({
      user_id: userId,
      item_id: input.item_id,
      consumed_at: localMinuteToUtc(input.consumed_at, input.tz_offset_minutes),
      quantity: input.quantity,
      created: now,
      updated: now,
    });
}

export async function updateCalorieRecord(
  userId: number,
  input: UpdateCalorieRecordInput,
): Promise<void> {
  await assertOwnedItem(userId, input.item_id);
  const existing = await getDb()
    .select({ id: calorieRecords.id })
    .from(calorieRecords)
    .where(
      and(
        eq(calorieRecords.id, input.recordId),
        eq(calorieRecords.user_id, userId),
      ),
    )
    .limit(1);
  if (existing.length === 0) throw new Error("calorie_record_not_found");
  await getDb()
    .update(calorieRecords)
    .set({
      item_id: input.item_id,
      consumed_at: localMinuteToUtc(input.consumed_at, input.tz_offset_minutes),
      quantity: input.quantity,
      updated: new Date(),
    })
    .where(
      and(
        eq(calorieRecords.id, input.recordId),
        eq(calorieRecords.user_id, userId),
      ),
    );
}

export async function deleteCalorieRecord(
  userId: number,
  recordId: number,
): Promise<void> {
  const existing = await getDb()
    .select({ id: calorieRecords.id })
    .from(calorieRecords)
    .where(
      and(eq(calorieRecords.id, recordId), eq(calorieRecords.user_id, userId)),
    )
    .limit(1);
  if (existing.length === 0) throw new Error("calorie_record_not_found");
  await getDb()
    .delete(calorieRecords)
    .where(
      and(eq(calorieRecords.id, recordId), eq(calorieRecords.user_id, userId)),
    );
}

export async function getCalorieSummary(
  userId: number,
  now = new Date(),
): Promise<{
  goal_kcal: number;
  periods: Array<{ days: 1 | 7 | 28; daily_kcal: number; percentage: number }>;
}> {
  const start = new Date(now.getTime() - 28 * DAY_MS);
  const rows = await getDb()
    .select({
      consumed_at: calorieRecords.consumed_at,
      quantity: calorieRecords.quantity,
      kcal: calorieItems.kcal,
    })
    .from(calorieRecords)
    .innerJoin(calorieItems, eq(calorieItems.id, calorieRecords.item_id))
    .where(
      and(
        eq(calorieRecords.user_id, userId),
        eq(calorieItems.user_id, userId),
        gte(calorieRecords.consumed_at, start),
        lte(calorieRecords.consumed_at, now),
      ),
    );
  const preferences = await getUserPreferences(userId);
  const goal = preferences.calorie_goal_kcal ?? DEFAULT_CALORIE_GOAL_KCAL;
  const periods = ([1, 7, 28] as const).map((days) => {
    const periodStart = now.getTime() - days * DAY_MS;
    const total = rows
      .filter((row) => row.consumed_at.getTime() >= periodStart)
      .reduce((sum, row) => sum + row.kcal * row.quantity, 0);
    return {
      days,
      daily_kcal: Math.round(total / days),
      percentage: Math.round((total / (goal * days)) * 1000) / 10,
    };
  });
  return { goal_kcal: goal, periods };
}

export async function importCalorieItems(
  userId: number,
  rows: CalorieItemCsvRow[],
): Promise<{ added: number; updated: number }> {
  if (new Set(rows.map((row) => row.name)).size !== rows.length) {
    throw new Error("calorie_csv_duplicate_item");
  }
  const existing = await getCalorieItems(userId);
  const existingByName = new Map(existing.map((item) => [item.name, item]));
  let added = 0;
  let updated = 0;
  await getDb().transaction(async (tx) => {
    const now = new Date();
    for (const row of rows) {
      const item = existingByName.get(row.name);
      if (item) {
        await tx
          .update(calorieItems)
          .set({ kcal: row.kcal, note: row.note, updated: now })
          .where(
            and(eq(calorieItems.id, item.id), eq(calorieItems.user_id, userId)),
          );
        updated += 1;
      } else {
        await tx.insert(calorieItems).values({
          user_id: userId,
          name: row.name,
          kcal: row.kcal,
          note: row.note,
          created: now,
          updated: now,
        });
        added += 1;
      }
    }
  });
  return { added, updated };
}

export async function importCalorieRecords(
  userId: number,
  rows: CalorieRecordCsvRow[],
  offsetMinutes: number,
): Promise<{ added: number }> {
  const items = await getCalorieItems(userId);
  const itemIds = new Map(items.map((item) => [item.name, item.id]));
  const values = rows.map((row) => {
    const itemId = itemIds.get(row.item_name);
    if (itemId === undefined) throw new Error("calorie_csv_unknown_item");
    const now = new Date();
    return {
      user_id: userId,
      item_id: itemId,
      consumed_at: localMinuteToUtc(row.consumed_at, offsetMinutes),
      quantity: row.quantity,
      created: now,
      updated: now,
    };
  });
  if (values.length > 0) {
    await getDb().transaction(async (tx) => {
      await tx.insert(calorieRecords).values(values);
    });
  }
  return { added: values.length };
}
