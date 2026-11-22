import type { TimerInfo } from "#lib/types.ts";

export function calcTimerRemainingMs(
  timer: TimerInfo,
  offsetMs: number,
): number {
  if (!timer.running || !timer.startedAt) {
    return timer.remainingSeconds * 1000;
  }
  const startedAtMs = new Date(timer.startedAt).getTime();
  const elapsedMs = Date.now() + offsetMs - startedAtMs;
  return Math.max(0, timer.remainingSeconds * 1000 - elapsedMs);
}

export function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatTargetTime(targetMinutes: number): string {
  const h = Math.floor(targetMinutes / 60);
  const m = targetMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parseTargetTime(input: string): number | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function calcSecondsUntilTarget(targetMinutes: number): number {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowSeconds = now.getSeconds();
  let diffMinutes = targetMinutes - nowMinutes;
  if (diffMinutes < 0 || (diffMinutes === 0 && nowSeconds > 0)) {
    diffMinutes += 24 * 60;
  }
  return diffMinutes * 60 - nowSeconds;
}

export function parseTimeInput(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const parts = trimmed.split(":");
  if (parts.length < 1 || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n !== Math.floor(n))) {
    return null;
  }
  let total: number;
  if (nums.length === 3) {
    total = nums[0] * 3600 + nums[1] * 60 + nums[2];
  } else if (nums.length === 2) {
    total = nums[0] * 60 + nums[1];
  } else {
    total = nums[0];
  }
  if (total < 0 || total > 359999) return null;
  return total;
}
