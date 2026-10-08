/**
 * @fileoverview タイマー残り時間計算ユーティリティ
 *
 * TimerCard と TimerAlarmMonitor の両方で使われる残り時間計算ロジックを共通化する。
 */

import type { TimerInfo } from "#lib/types.ts";

/**
 * タイマーの残りミリ秒を計算する。
 * @param timer タイマー情報
 * @param offsetMs サーバーとの時刻差（ms）。Date.now() + offsetMs ≒ サーバー時刻。
 */
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

/** 秒数を HH:MM:SS 形式にフォーマットする */
export function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** targetMinutes を "HH:MM" 形式にフォーマットする */
export function formatTargetTime(targetMinutes: number): string {
  const h = Math.floor(targetMinutes / 60);
  const m = targetMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" 形式を targetMinutes (0-1439) にパースする */
export function parseTargetTime(input: string): number | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** 目標時刻（分）までの残り秒数を計算する（ローカル時刻基準、クライアント用） */
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

/**
 * 時刻文字列を秒数にパースする。
 * `HH:MM:SS` / `MM:SS` / `SS` 形式を受け付ける。不正入力は null を返す。
 */
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
