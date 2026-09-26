/**
 * @fileoverview カロリー計算API
 */

import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNotNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import {
  DEFAULT_CALORIE_GOAL_KCAL,
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
} from "$lib/schemas";
import { getDb } from "../db";
import { calorieAutoRecords, calorieItems, calorieRecords } from "../schema";
import { getUserPreferences } from "./users";

const DAY_MS = 24 * 60 * 60 * 1000;

type SummaryRow = { consumed_at: Date; total_kcal: number };

/**
 * 1件の記録の合計kcalを返す
 *
 * 一時項目は数量欄の値をkcalとして持ち、品目のkcalと掛け算しない。
 */
function recordTotalKcal(row: {
  temporary_name: string | null;
  item_kcal: number | null;
  quantity: number;
}): number {
  if (row.temporary_name !== null) return row.quantity;
  if (row.item_kcal === null) {
    throw new Error("品目を参照しない記録に一時項目名がありません");
  }
  return row.item_kcal * row.quantity;
}

/**
 * 直近の摂取ペースを1日当たりのkcalとして返す
 *
 * 摂取からの経過時間に対する重みを時定数24時間の指数減衰とし、重み付き合計を返す。
 * 重みを時間で積分すると24時間になるため、一定の速さで摂取し続けた場合の値は
 * 1日当たりの摂取量と一致する。
 * 窓の境界を持たないため、摂取から一定時間が過ぎた時点で値が不連続に減らない。
 * 摂取直後の重みが1であり、摂取したkcalがそのまま値へ加わる。
 */
function dailyPaceKcal(rows: SummaryRow[], now: Date): number {
  return rows.reduce(
    (sum, row) =>
      sum +
      row.total_kcal *
        Math.exp(-(now.getTime() - row.consumed_at.getTime()) / DAY_MS),
    0,
  );
}

/** 指定した日数の窓に入る記録から1日当たりの平均kcalを返す */
function averageDailyKcal(rows: SummaryRow[], now: Date, days: number): number {
  const start = now.getTime() - days * DAY_MS;
  const total = rows.reduce(
    (sum, row) =>
      row.consumed_at.getTime() >= start ? sum + row.total_kcal : sum,
    0,
  );
  return total / days;
}

export type CalorieItem = {
  id: number;
  name: string;
  kcal: number;
  note: string;
};

export type CalorieRecord = {
  id: number;
  /** 一時項目ではnull */
  item_id: number | null;
  /** 品目の記録では品目名、一時項目では一時項目名 */
  item_name: string;
  /** 一時項目ではnull */
  item_kcal: number | null;
  consumed_at: string;
  /** 一時項目ではkcal */
  quantity: number;
  total_kcal: number;
  temporary: boolean;
};

export type CalorieAutoRecord = {
  id: number;
  item_id: number;
  item_name: string;
  time_of_day: string;
  quantity: number;
  enabled: boolean;
};

type LocalDate = { year: number; month: number; day: number };
type LocalTime = { hour: number; minute: number };

function parseLocalDate(value: string): LocalDate {
  const [year, month, day] = value.split("/").map(Number);
  return { year, month, day };
}

function parseLocalTime(value: string): LocalTime {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

/**
 * 現地の年月日・時分をUTCの時刻へ変換する。
 * 日が月末を超える値（31日の翌日など）は`Date.UTC`が翌月へ繰り上げる。
 */
function localToUtc(
  date: LocalDate,
  time: LocalTime,
  offsetMinutes: number,
): Date {
  return new Date(
    Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute) -
      offsetMinutes * 60_000,
  );
}

function localMinuteToUtc(value: string, offsetMinutes: number): Date {
  const [datePart, timePart] = value.split(" ");
  return localToUtc(
    parseLocalDate(datePart),
    parseLocalTime(timePart),
    offsetMinutes,
  );
}

/** 指定時刻のUTCから現地の年月日を返す */
function toLocalDate(value: Date, offsetMinutes: number): LocalDate {
  const local = new Date(value.getTime() + offsetMinutes * 60_000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
  };
}

/** 開始日から終了日までの日数（両端を含む）を返す。終了日が開始日より前なら0以下になる */
function countDays(start: LocalDate, end: LocalDate): number {
  return (
    (Date.UTC(end.year, end.month - 1, end.day) -
      Date.UTC(start.year, start.month - 1, start.day)) /
      DAY_MS +
    1
  );
}

/** 現地時刻`timeOfDay`のうち`now`より後で最初の時刻をUTCで返す */
function nextRunAt(timeOfDay: string, offsetMinutes: number, now: Date): Date {
  const today = localToUtc(
    toLocalDate(now, offsetMinutes),
    parseLocalTime(timeOfDay),
    offsetMinutes,
  );
  return today.getTime() > now.getTime()
    ? today
    : new Date(today.getTime() + DAY_MS);
}

function calculateWindow(
  windowOffset: number,
  offsetMinutes: number,
  now: Date,
): { start: Date; endExclusive: Date } {
  const localToday = toLocalDate(now, offsetMinutes);
  const localTomorrow = localToUtc(
    { ...localToday, day: localToday.day + 1 },
    { hour: 0, minute: 0 },
    offsetMinutes,
  );
  const endExclusive = new Date(
    localTomorrow.getTime() - windowOffset * 30 * DAY_MS,
  );
  return {
    start: new Date(endExclusive.getTime() - 30 * DAY_MS),
    endExclusive,
  };
}

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

/**
 * 利用者の記録を選ぶ条件（品目との外部結合と組で使う）
 *
 * 一時項目の記録は品目を参照しないため外部結合で残し、
 * 品目の記録は利用者自身の品目を参照するものだけを対象とする。
 */
function ownRecordCondition(userId: number) {
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
      item_name: sql<string>`COALESCE(${calorieRecords.temporary_name}, ${calorieItems.name})`,
      item_kcal: calorieItems.kcal,
      temporary_name: calorieRecords.temporary_name,
      consumed_at: calorieRecords.consumed_at,
      quantity: calorieRecords.quantity,
    })
    .from(calorieRecords)
    .leftJoin(calorieItems, eq(calorieItems.id, calorieRecords.item_id))
    .where(and(ownRecordCondition(userId), rangeCondition))
    .orderBy(desc(calorieRecords.consumed_at), desc(calorieRecords.id));
  return rows.map(({ temporary_name, ...row }) => ({
    ...row,
    consumed_at: row.consumed_at.toISOString(),
    total_kcal: recordTotalKcal({ ...row, temporary_name }),
    temporary: temporary_name !== null,
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

/**
 * 記録の品目参照又は一時項目名を保存値へ変換する
 *
 * 一時項目名は品目表と照合しない。同名の品目があっても一時項目のまま保存し、掛け算の対象にしない。
 */
async function recordTargetValues(
  userId: number,
  input: { item_id?: number; temporary_name?: string },
): Promise<{ item_id: number | null; temporary_name: string | null }> {
  if (input.temporary_name !== undefined) {
    return { item_id: null, temporary_name: input.temporary_name };
  }
  if (input.item_id === undefined) throw new Error("calorie_item_not_found");
  await assertOwnedItem(userId, input.item_id);
  return { item_id: input.item_id, temporary_name: null };
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
  if (existing.length === 0) throw new Error("calorie_record_not_found");
  await getDb()
    .update(calorieRecords)
    .set({
      ...target,
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

/** 開始日から終了日まで、各日の指定時刻に記録を1件ずつ追加する */
export async function bulkCreateCalorieRecords(
  userId: number,
  input: BulkCreateCalorieRecordsInput,
): Promise<{ added: number }> {
  const start = parseLocalDate(input.start_date);
  const days = countDays(start, parseLocalDate(input.end_date));
  await assertOwnedItem(userId, input.item_id);
  const time = parseLocalTime(input.time_of_day);
  const now = new Date();
  const values = Array.from({ length: Math.max(days, 0) }, (_, index) => ({
    user_id: userId,
    item_id: input.item_id,
    consumed_at: localToUtc(
      { ...start, day: start.day + index },
      time,
      input.tz_offset_minutes,
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
  const start = parseLocalDate(input.start_date);
  const end = parseLocalDate(input.end_date);
  await assertOwnedItem(userId, input.item_id);
  const midnight = { hour: 0, minute: 0 };
  const [result] = await getDb()
    .delete(calorieRecords)
    .where(
      and(
        eq(calorieRecords.user_id, userId),
        eq(calorieRecords.item_id, input.item_id),
        gte(
          calorieRecords.consumed_at,
          localToUtc(start, midnight, input.tz_offset_minutes),
        ),
        lt(
          calorieRecords.consumed_at,
          localToUtc(
            { ...end, day: end.day + 1 },
            midnight,
            input.tz_offset_minutes,
          ),
        ),
      ),
    );
  return { deleted: result.affectedRows };
}

export async function getCalorieAutoRecords(
  userId: number,
): Promise<CalorieAutoRecord[]> {
  const rows = await getDb()
    .select({
      id: calorieAutoRecords.id,
      item_id: calorieAutoRecords.item_id,
      item_name: calorieItems.name,
      time_of_day: calorieAutoRecords.time_of_day,
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
  if (rows.length === 0) throw new Error("calorie_auto_record_not_found");
}

/**
 * 自動記録設定の保存値を組み立てる。
 * 作成・変更のたびに次回時刻を`now`より後へ置き直すため、
 * OFFの間に過ぎた時刻はONへ戻しても遡って記録しない。
 */
function autoRecordValues(input: CalorieAutoRecordInput, now: Date) {
  return {
    item_id: input.item_id,
    time_of_day: input.time_of_day,
    quantity: input.quantity,
    enabled: input.enabled ? 1 : 0,
    tz_offset_minutes: input.tz_offset_minutes,
    next_run_at: nextRunAt(input.time_of_day, input.tz_offset_minutes, now),
    updated: now,
  };
}

export async function createCalorieAutoRecord(
  userId: number,
  input: CalorieAutoRecordInput,
  now = new Date(),
): Promise<void> {
  await assertOwnedItem(userId, input.item_id);
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
  await assertOwnedItem(userId, input.item_id);
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
  await assertOwnedAutoRecord(userId, autoRecordId);
  await getDb()
    .delete(calorieAutoRecords)
    .where(
      and(
        eq(calorieAutoRecords.id, autoRecordId),
        eq(calorieAutoRecords.user_id, userId),
      ),
    );
}

/**
 * ONの自動記録設定のうち次回時刻が`now`以前のものについて、過ぎた時刻ごとに記録を追加し、
 * 記録を追加した利用者のIDを返す。
 *
 * 次回時刻から1日刻みで`now`以前の時刻を記録し、次回時刻を`now`より後へ進める。
 * 1件の失敗が他の設定の処理を止めないよう、設定ごとに例外を捕捉する。
 * 単一プロセスから60秒間隔で呼ばれる前提であり、並行呼び出しの排他は持たない。
 */
export async function processCalorieAutoRecords(now: Date): Promise<number[]> {
  const db = getDb();
  const rules = await db
    .select()
    .from(calorieAutoRecords)
    .where(
      and(
        eq(calorieAutoRecords.enabled, 1),
        lte(calorieAutoRecords.next_run_at, now),
      ),
    );
  const notifiedUserIds = new Set<number>();
  for (const rule of rules) {
    try {
      const consumedAts: Date[] = [];
      let next = rule.next_run_at.getTime();
      while (next <= now.getTime()) {
        consumedAts.push(new Date(next));
        next += DAY_MS;
      }
      await db.transaction(async (tx) => {
        await tx.insert(calorieRecords).values(
          consumedAts.map((consumedAt) => ({
            user_id: rule.user_id,
            item_id: rule.item_id,
            consumed_at: consumedAt,
            quantity: rule.quantity,
            created: now,
            updated: now,
          })),
        );
        await tx
          .update(calorieAutoRecords)
          .set({ next_run_at: new Date(next) })
          .where(eq(calorieAutoRecords.id, rule.id));
      });
      notifiedUserIds.add(rule.user_id);
    } catch (error) {
      console.error(
        `[scheduler] カロリー自動記録 ${rule.id} の処理に失敗しました`,
        error,
      );
    }
  }
  return [...notifiedUserIds];
}

/** 確定日の現地の区切り時刻。深夜の摂取を前日へ数える */
const DAY_BOUNDARY_HOUR = 4;
/** 達成状況を表示する確定日の数 */
const ACHIEVEMENT_DAYS = 28;
/** 達成を判定する平均の日数 */
const ACHIEVEMENT_AVERAGE_DAYS = 7;

export type CalorieAchievementStatus = "achieved" | "missed" | "unrated";

export type CalorieAchievement = {
  /** 直近の確定日（古い順）。日付は区切り時刻で始まる日の現地の年月日 */
  days: Array<{
    date: string;
    average_kcal: number | null;
    status: CalorieAchievementStatus;
  }>;
  /** 昨日から遡って続く達成日の数（最大で`days`の件数） */
  streak_days: number;
  /** 昨日の7日平均。判定対象外ならnull */
  latest_average_kcal: number | null;
  /** 昨日の7日平均から7日前の7日平均を引いた値。いずれかが判定対象外ならnull */
  weekly_change_kcal: number | null;
};

/** 指定時刻を含む確定日の開始時刻をUTCで返す */
function dayStartOf(value: Date, offsetMinutes: number): Date {
  const shifted = new Date(value.getTime() - DAY_BOUNDARY_HOUR * 60 * 60_000);
  return localToUtc(
    toLocalDate(shifted, offsetMinutes),
    { hour: DAY_BOUNDARY_HOUR, minute: 0 },
    offsetMinutes,
  );
}

function formatLocalDate(date: LocalDate): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.year}/${pad(date.month)}/${pad(date.day)}`;
}

/**
 * 確定日ごとの7日平均から達成状況を求める
 *
 * 当日は摂取が続くため判定しない。7日の窓が最初の記録の日より前へかかる日は、
 * 記録を始める前の期間を0kcalとして達成扱いにしないよう判定対象外とする。
 * 記録の無い日は0kcalとして平均へ含める。
 */
function calculateAchievement(
  rows: SummaryRow[],
  firstRecordAt: Date | undefined,
  goal: number,
  now: Date,
  offsetMinutes: number,
): CalorieAchievement {
  const todayStart = dayStartOf(now, offsetMinutes).getTime();
  const firstDayStart =
    firstRecordAt === undefined
      ? undefined
      : dayStartOf(firstRecordAt, offsetMinutes).getTime();
  // totals[n]は当日からn日前の確定日の合計（n=0は当日で使わない）
  const totals = Array.from(
    { length: ACHIEVEMENT_DAYS + ACHIEVEMENT_AVERAGE_DAYS },
    () => 0,
  );
  for (const row of rows) {
    const daysAgo = Math.ceil(
      (todayStart - row.consumed_at.getTime()) / DAY_MS,
    );
    if (daysAgo >= 1 && daysAgo < totals.length) {
      totals[daysAgo] += row.total_kcal;
    }
  }
  const averageOf = (daysAgo: number): number | undefined => {
    const windowStart =
      todayStart - (daysAgo + ACHIEVEMENT_AVERAGE_DAYS - 1) * DAY_MS;
    if (firstDayStart === undefined || windowStart < firstDayStart) {
      return undefined;
    }
    const sum = totals
      .slice(daysAgo, daysAgo + ACHIEVEMENT_AVERAGE_DAYS)
      .reduce((acc, value) => acc + value, 0);
    return sum / ACHIEVEMENT_AVERAGE_DAYS;
  };

  // 新しい順に求めてから古い順へ並べ替える
  const newestFirst = Array.from({ length: ACHIEVEMENT_DAYS }, (_, index) => {
    const daysAgo = index + 1;
    const average = averageOf(daysAgo);
    const averageKcal = average === undefined ? null : Math.round(average);
    const status: CalorieAchievementStatus =
      averageKcal === null
        ? "unrated"
        : averageKcal <= goal
          ? "achieved"
          : "missed";
    return {
      date: formatLocalDate(
        toLocalDate(new Date(todayStart - daysAgo * DAY_MS), offsetMinutes),
      ),
      average_kcal: averageKcal,
      status,
    };
  });
  const missedIndex = newestFirst.findIndex((day) => day.status !== "achieved");
  const latest = averageOf(1);
  const previous = averageOf(1 + ACHIEVEMENT_AVERAGE_DAYS);
  return {
    days: [...newestFirst].reverse(),
    streak_days: missedIndex === -1 ? ACHIEVEMENT_DAYS : missedIndex,
    latest_average_kcal: latest === undefined ? null : Math.round(latest),
    weekly_change_kcal:
      latest === undefined || previous === undefined
        ? null
        : Math.round(latest - previous),
  };
}

export async function getCalorieSummary(
  userId: number,
  tzOffsetMinutes: number,
  now = new Date(),
): Promise<{
  goal_kcal: number;
  periods: Array<{ days: 1 | 7 | 28; daily_kcal: number; percentage: number }>;
  achievement: CalorieAchievement;
}> {
  // 28日間平均の窓と、達成状況の最も古い確定日の7日平均に要する日を取得する。
  // それより前の記録は指数減衰の重みがexp(-28)未満となるため取得しない
  const start = new Date(
    Math.min(
      now.getTime() - 28 * DAY_MS,
      dayStartOf(now, tzOffsetMinutes).getTime() -
        (ACHIEVEMENT_DAYS + ACHIEVEMENT_AVERAGE_DAYS - 1) * DAY_MS,
    ),
  );
  const recordRows = await getDb()
    .select({
      consumed_at: calorieRecords.consumed_at,
      quantity: calorieRecords.quantity,
      item_kcal: calorieItems.kcal,
      temporary_name: calorieRecords.temporary_name,
    })
    .from(calorieRecords)
    .leftJoin(calorieItems, eq(calorieItems.id, calorieRecords.item_id))
    .where(
      and(
        ownRecordCondition(userId),
        gte(calorieRecords.consumed_at, start),
        lte(calorieRecords.consumed_at, now),
      ),
    );
  const rows = recordRows.map((row) => ({
    consumed_at: row.consumed_at,
    total_kcal: recordTotalKcal(row),
  }));
  const [firstRecord] = await getDb()
    .select({ consumed_at: calorieRecords.consumed_at })
    .from(calorieRecords)
    .where(eq(calorieRecords.user_id, userId))
    .orderBy(asc(calorieRecords.consumed_at))
    .limit(1);
  const preferences = await getUserPreferences(userId);
  const goal = preferences.calorie_goal_kcal ?? DEFAULT_CALORIE_GOAL_KCAL;
  const periods = ([1, 7, 28] as const).map((days) => {
    const value =
      days === 1 ? dailyPaceKcal(rows, now) : averageDailyKcal(rows, now, days);
    return {
      days,
      daily_kcal: Math.round(value),
      percentage: Math.round((value / goal) * 1000) / 10,
    };
  });
  const achievement = calculateAchievement(
    rows,
    firstRecord?.consumed_at,
    goal,
    now,
    tzOffsetMinutes,
  );
  return { goal_kcal: goal, periods, achievement };
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
    const itemId = row.temporary ? null : itemIds.get(row.item_name);
    if (itemId === undefined) throw new Error("calorie_csv_unknown_item");
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
