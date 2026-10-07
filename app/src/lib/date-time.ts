export const SCHEDULE_TIMEZONE = "Asia/Tokyo";
export const SCHEDULE_UTC_OFFSET_MS = 9 * 3600 * 1000;

export function getTimezoneOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatLocalMinute(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
