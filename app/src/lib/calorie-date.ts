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

export function toLocalDate(value: Date, offsetMinutes: number): LocalDate {
  const local = new Date(value.getTime() + offsetMinutes * 60_000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
  };
}

export function countDays(start: LocalDate, end: LocalDate): number {
  return (
    (Date.UTC(end.year, end.month - 1, end.day) -
      Date.UTC(start.year, start.month - 1, start.day)) /
      DAY_MS +
    1
  );
}

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
