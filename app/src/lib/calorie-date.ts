/** カロリー記録の現地日時と日の区切りをUTCへ換算する純粋関数。 */

import { pad2 } from "#lib/date-time.ts";

export const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_BOUNDARY_HOUR = 4;

type LocalDate = { year: number; month: number; day: number };
type LocalTime = { hour: number; minute: number };

export function parseLocalDate(value: string): LocalDate {
  const [year, month, day] = value.split("/").map(Number);
  return { year, month, day };
}

export function parseLocalTime(value: string): LocalTime {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

/**
 * 現地の年月日・時分をUTCの時刻へ変換する。
 * 日が月末を超える値（31日の翌日など）は`Date.UTC`が翌月へ繰り上げる。
 */
export function localToUtc(
  date: LocalDate,
  time: LocalTime,
  offsetMinutes: number,
): Date {
  return new Date(
    Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute) -
      offsetMinutes * 60_000,
  );
}

export function localMinuteToUtc(value: string, offsetMinutes: number): Date {
  const [datePart, timePart] = value.split(" ");
  return localToUtc(
    parseLocalDate(datePart),
    parseLocalTime(timePart),
    offsetMinutes,
  );
}

/** 指定時刻のUTCから現地の年月日を返す */
export function toLocalDate(value: Date, offsetMinutes: number): LocalDate {
  const local = new Date(value.getTime() + offsetMinutes * 60_000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
  };
}

/** 開始日から終了日までの日数（両端を含む）を返す。終了日が開始日より前なら0以下になる */
export function countDays(start: LocalDate, end: LocalDate): number {
  return (
    (Date.UTC(end.year, end.month - 1, end.day) -
      Date.UTC(start.year, start.month - 1, start.day)) /
      DAY_MS +
    1
  );
}

/** 現地時刻`timeOfDay`のうち`now`より後で最初の時刻をUTCで返す */
export function nextRunAt(
  timeOfDay: string,
  offsetMinutes: number,
  now: Date,
): Date {
  const today = localToUtc(
    toLocalDate(now, offsetMinutes),
    parseLocalTime(timeOfDay),
    offsetMinutes,
  );
  return today.getTime() > now.getTime()
    ? today
    : new Date(today.getTime() + DAY_MS);
}

export function calculateWindow(
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

/** 指定時刻を含む確定日の開始時刻をUTCで返す */
export function dayStartOf(value: Date, offsetMinutes: number): Date {
  const shifted = new Date(value.getTime() - DAY_BOUNDARY_HOUR * 60 * 60_000);
  return localToUtc(
    toLocalDate(shifted, offsetMinutes),
    { hour: DAY_BOUNDARY_HOUR, minute: 0 },
    offsetMinutes,
  );
}

export function formatLocalDate(date: LocalDate): string {
  return `${date.year}/${pad2(date.month)}/${pad2(date.day)}`;
}
