import { ApiError } from "../api-errors";
/** 品目・記録・自動記録のCRUDとCSVの保存境界。DBとCSVの列名はそれぞれの形式を保つ。 */

import { and, desc, eq, gte, isNotNull, lt, or, sql } from "drizzle-orm";
import {
  calculateWindow,
  countDays,
  localMinuteToUtc,
  localToUtc,
  nextRunAt,
  parseLocalDate,
  parseLocalTime,
} from "#lib/calorie-date.ts";
import { recordTotalKcal } from "#lib/calorie-summary.ts";
import {
  type BulkCreateCalorieRecordsInput,
  type BulkDeleteCalorieRecordsInput,
  type CalorieAutoRecordInput,
  type CalorieItemCsvRow,
  type CalorieItemInput,
  type CalorieRecordCsvRow,
  type CalorieRecordInput,
  type ListCalorieRecordsInput,
  type UpdateCalorieAutoRecordInput,
  type UpdateCalorieItemInput,
  type UpdateCalorieRecordInput,
} from "#lib/schemas.ts";
import { getDb } from "../db";
import { calorieAutoRecords, calorieItems, calorieRecords } from "../schema";

export type CalorieItem = Awaited<ReturnType<typeof getCalorieItems>>[number];
export type CalorieRecord = Awaited<ReturnType<typeof selectRecords>>[number];
export type CalorieAutoRecord = Awaited<
  ReturnType<typeof getCalorieAutoRecords>
>[number];

/**
 * MariaDBのエラーコードが一致するかを返す
 *
 * drizzle-ormはドライバーのエラーをDrizzleQueryErrorで包み、元のエラーを`cause`へ置くため、
 * 包まれたエラーと元のエラーの両方を調べる。
 */
function hasDbErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  return [error, "cause" in error ? error.cause : undefined].some(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "code" in candidate &&
      candidate.code === code,
  );
}

function isDuplicateEntry(error: unknown): boolean {
  return hasDbErrorCode(error, "ER_DUP_ENTRY");
}

function isReferencedRow(error: unknown): boolean {
  return hasDbErrorCode(error, "ER_ROW_IS_REFERENCED_2");
}

async function assertOwnedItem(userId: number, itemId: number): Promise<void> {
  const rows = await getDb()
    .select({ id: calorieItems.id })
    .from(calorieItems)
    .where(and(eq(calorieItems.id, itemId), eq(calorieItems.user_id, userId)))
    .limit(1);
  if (rows.length === 0) throw new ApiError("calorie_item_not_found");
}

export async function getCalorieItems(userId: number) {
  // SELECTの単一テーブル向け最適化による修飾除去を避け、相関先を品目のIDへ固定する。
  const itemId = sql`${calorieItems}.${sql.identifier(calorieItems.id.name)}`;
  const rows = await getDb()
    .select({
      id: calorieItems.id,
      name: calorieItems.name,
      kcal: calorieItems.kcal,
      note: calorieItems.note,
      recordCount:
        sql<number>`(SELECT COUNT(*) FROM ${calorieRecords} WHERE ${calorieRecords.item_id} = ${itemId} AND ${calorieRecords.user_id} = ${userId})`.mapWith(
          Number,
        ),
      autoRecordCount:
        sql<number>`(SELECT COUNT(*) FROM ${calorieAutoRecords} WHERE ${calorieAutoRecords.item_id} = ${itemId} AND ${calorieAutoRecords.user_id} = ${userId})`.mapWith(
          Number,
        ),
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
      throw new ApiError("calorie_item_name_conflict", { cause: error });
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
      throw new ApiError("calorie_item_name_conflict", { cause: error });
    }
    throw error;
  }
}

/**
 * 記録と自動記録のどちらからも使われていない品目を削除する
 *
 * 使われている品目を削除すると記録の品目名とkcalが失われるため、
 * 両テーブルの外部キー制約（ON DELETE RESTRICT）が拒否した削除を`calorie_item_in_use`として返す。
 */
export async function deleteCalorieItem(
  userId: number,
  itemId: number,
): Promise<void> {
  try {
    await getDb()
      .delete(calorieItems)
      .where(
        and(eq(calorieItems.id, itemId), eq(calorieItems.user_id, userId)),
      );
  } catch (error) {
    if (isReferencedRow(error)) {
      throw new ApiError("calorie_item_in_use", { cause: error });
    }
    throw error;
  }
}

/**
 * ユーザーの記録を選ぶ条件（品目との外部結合と組で使う）
 *
 * 一時項目の記録は品目を参照しないため外部結合で残し、
 * 品目の記録はユーザー自身の品目を参照するものだけを対象とする。
 */
export function ownRecordCondition(userId: number) {
  return and(
    eq(calorieRecords.user_id, userId),
    or(
      isNotNull(calorieRecords.temporary_name),
      eq(calorieItems.user_id, userId),
    ),
  );
}

async function selectRecords(
  userId: number,
  range?: { start: Date; endExclusive: Date },
) {
  const rangeCondition = range
    ? and(
        gte(calorieRecords.consumed_at, range.start),
        lt(calorieRecords.consumed_at, range.endExclusive),
      )
    : undefined;
  const rows = await getDb()
    .select({
      id: calorieRecords.id,
      itemId: calorieRecords.item_id,
      itemName: sql<string>`COALESCE(${calorieRecords.temporary_name}, ${calorieItems.name})`,
      itemKcal: calorieItems.kcal,
      temporaryName: calorieRecords.temporary_name,
      consumedAt: calorieRecords.consumed_at,
      quantity: calorieRecords.quantity,
    })
    .from(calorieRecords)
    .leftJoin(calorieItems, eq(calorieItems.id, calorieRecords.item_id))
    .where(and(ownRecordCondition(userId), rangeCondition))
    .orderBy(desc(calorieRecords.consumed_at), desc(calorieRecords.id));
  return rows.map(({ temporaryName, ...row }) => ({
    ...row,
    consumedAt: row.consumedAt.toISOString(),
    totalKcal: recordTotalKcal({ ...row, temporaryName }),
    temporary: temporaryName !== null,
  }));
}

export async function getCalorieRecords(
  userId: number,
  input: ListCalorieRecordsInput,
  now = new Date(),
): Promise<{ records: CalorieRecord[]; windowOffset: number }> {
  const range = calculateWindow(input.windowOffset, input.tzOffsetMinutes, now);
  return {
    records: await selectRecords(userId, range),
    windowOffset: input.windowOffset,
  };
}

export async function getAllCalorieRecords(
  userId: number,
): Promise<CalorieRecord[]> {
  return selectRecords(userId);
}

/**
 * 記録の品目参照または一時項目名を保存値へ変換する
 *
 * 一時項目名は品目表から検索しない。同名の品目があっても一時項目のまま保存し、掛け算の対象にしない。
 */
async function recordTargetValues(
  userId: number,
  input: { itemId?: number; temporaryName?: string },
): Promise<{ item_id: number | null; temporary_name: string | null }> {
  if (input.temporaryName !== undefined) {
    return { item_id: null, temporary_name: input.temporaryName };
  }
  if (input.itemId === undefined) throw new ApiError("calorie_item_not_found");
  await assertOwnedItem(userId, input.itemId);
  return { item_id: input.itemId, temporary_name: null };
}

export async function createCalorieRecord(
  userId: number,
  input: CalorieRecordInput,
): Promise<void> {
  const target = await recordTargetValues(userId, input);
  const now = new Date();
  await getDb()
    .insert(calorieRecords)
    .values({
      user_id: userId,
      ...target,
      consumed_at: localMinuteToUtc(input.consumedAt, input.tzOffsetMinutes),
      quantity: input.quantity,
      created: now,
      updated: now,
    });
}

export async function updateCalorieRecord(
  userId: number,
  input: UpdateCalorieRecordInput,
): Promise<void> {
  const target = await recordTargetValues(userId, input);
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
  if (existing.length === 0) throw new ApiError("calorie_record_not_found");
  await getDb()
    .update(calorieRecords)
    .set({
      ...target,
      consumed_at: localMinuteToUtc(input.consumedAt, input.tzOffsetMinutes),
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
  await getDb()
    .delete(calorieRecords)
    .where(
      and(eq(calorieRecords.id, recordId), eq(calorieRecords.user_id, userId)),
    );
}

/** 開始日から終了日まで、各日の指定時刻に記録を1件ずつ追加する */
export async function bulkCreateCalorieRecords(
  userId: number,
  input: BulkCreateCalorieRecordsInput,
): Promise<{ added: number }> {
  const start = parseLocalDate(input.startDate);
  const days = countDays(start, parseLocalDate(input.endDate));
  await assertOwnedItem(userId, input.itemId);
  const time = parseLocalTime(input.timeOfDay);
  const now = new Date();
  const values = Array.from({ length: Math.max(days, 0) }, (_, index) => ({
    user_id: userId,
    item_id: input.itemId,
    consumed_at: localToUtc(
      { ...start, day: start.day + index },
      time,
      input.tzOffsetMinutes,
    ),
    quantity: input.quantity,
    created: now,
    updated: now,
  }));
  if (values.length > 0) await getDb().insert(calorieRecords).values(values);
  return { added: values.length };
}

/** 開始日の0時から終了日の翌日0時までにある、指定品目の記録を削除する */
export async function bulkDeleteCalorieRecords(
  userId: number,
  input: BulkDeleteCalorieRecordsInput,
): Promise<{ deleted: number }> {
  const start = parseLocalDate(input.startDate);
  const end = parseLocalDate(input.endDate);
  await assertOwnedItem(userId, input.itemId);
  const midnight = { hour: 0, minute: 0 };
  const [result] = await getDb()
    .delete(calorieRecords)
    .where(
      and(
        eq(calorieRecords.user_id, userId),
        eq(calorieRecords.item_id, input.itemId),
        gte(
          calorieRecords.consumed_at,
          localToUtc(start, midnight, input.tzOffsetMinutes),
        ),
        lt(
          calorieRecords.consumed_at,
          localToUtc(
            { ...end, day: end.day + 1 },
            midnight,
            input.tzOffsetMinutes,
          ),
        ),
      ),
    );
  return { deleted: result.affectedRows };
}

export async function getCalorieAutoRecords(userId: number) {
  const rows = await getDb()
    .select({
      id: calorieAutoRecords.id,
      itemId: calorieAutoRecords.item_id,
      itemName: calorieItems.name,
      timeOfDay: calorieAutoRecords.time_of_day,
      quantity: calorieAutoRecords.quantity,
      enabled: calorieAutoRecords.enabled,
    })
    .from(calorieAutoRecords)
    .innerJoin(
      calorieItems,
      and(
        eq(calorieItems.id, calorieAutoRecords.item_id),
        eq(calorieItems.user_id, userId),
      ),
    )
    .where(eq(calorieAutoRecords.user_id, userId))
    .orderBy(calorieAutoRecords.time_of_day, calorieAutoRecords.id);
  return rows.map((row) => ({ ...row, enabled: row.enabled === 1 }));
}

async function assertOwnedAutoRecord(
  userId: number,
  autoRecordId: number,
): Promise<void> {
  const rows = await getDb()
    .select({ id: calorieAutoRecords.id })
    .from(calorieAutoRecords)
    .where(
      and(
        eq(calorieAutoRecords.id, autoRecordId),
        eq(calorieAutoRecords.user_id, userId),
      ),
    )
    .limit(1);
  if (rows.length === 0) throw new ApiError("calorie_auto_record_not_found");
}

/**
 * 自動記録設定の保存値を組み立てる。
 * 作成・変更のたびに次回時刻を`now`より後へ置き直すため、
 * OFFの間に過ぎた時刻はONへ戻しても遡って記録しない。
 */
function autoRecordValues(input: CalorieAutoRecordInput, now: Date) {
  return {
    item_id: input.itemId,
    time_of_day: input.timeOfDay,
    quantity: input.quantity,
    enabled: input.enabled ? 1 : 0,
    tz_offset_minutes: input.tzOffsetMinutes,
    next_run_at: nextRunAt(input.timeOfDay, input.tzOffsetMinutes, now),
    updated: now,
  };
}

export async function createCalorieAutoRecord(
  userId: number,
  input: CalorieAutoRecordInput,
  now = new Date(),
): Promise<void> {
  await assertOwnedItem(userId, input.itemId);
  await getDb()
    .insert(calorieAutoRecords)
    .values({
      user_id: userId,
      ...autoRecordValues(input, now),
      created: now,
    });
}

export async function updateCalorieAutoRecord(
  userId: number,
  input: UpdateCalorieAutoRecordInput,
  now = new Date(),
): Promise<void> {
  await assertOwnedItem(userId, input.itemId);
  await assertOwnedAutoRecord(userId, input.autoRecordId);
  await getDb()
    .update(calorieAutoRecords)
    .set(autoRecordValues(input, now))
    .where(
      and(
        eq(calorieAutoRecords.id, input.autoRecordId),
        eq(calorieAutoRecords.user_id, userId),
      ),
    );
}

export async function deleteCalorieAutoRecord(
  userId: number,
  autoRecordId: number,
): Promise<void> {
  await getDb()
    .delete(calorieAutoRecords)
    .where(
      and(
        eq(calorieAutoRecords.id, autoRecordId),
        eq(calorieAutoRecords.user_id, userId),
      ),
    );
}

export async function importCalorieItems(
  userId: number,
  rows: CalorieItemCsvRow[],
): Promise<{ added: number; updated: number }> {
  if (new Set(rows.map((row) => row.name)).size !== rows.length) {
    throw new ApiError("calorie_csv_duplicate_item");
  }
  let added = 0;
  let updated = 0;
  await getDb().transaction(async (tx) => {
    const existing = await tx
      .select({ id: calorieItems.id, name: calorieItems.name })
      .from(calorieItems)
      .where(eq(calorieItems.user_id, userId));
    const existingByName = new Map(existing.map((item) => [item.name, item]));
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
    const itemId = row.temporary ? null : itemIds.get(row.item_name);
    if (itemId === undefined) throw new ApiError("calorie_csv_unknown_item");
    const now = new Date();
    return {
      user_id: userId,
      item_id: itemId,
      temporary_name: row.temporary ? row.item_name : null,
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
