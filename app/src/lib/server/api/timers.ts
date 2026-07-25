/**
 * @fileoverview タイマー関連API（CRUD・開始・停止・リセット・調整・並び替え）
 */

import { and, eq, max } from "drizzle-orm";
import type { z } from "zod";

import { TIMER_DEFAULT_RING_SECONDS } from "$lib/schemas";
import type { UpdateTimerSchema } from "$lib/schemas";
import type { TimerInfo } from "$lib/types";
import { getDb } from "../db";
import { timers } from "../schema";
import { toUtcIso } from "./common";

export type { TimerInfo };

/** updateTimer の data 引数型（UpdateTimerSchema から timerId を除いた型） */
type UpdateTimerData = Omit<z.infer<typeof UpdateTimerSchema>, "timerId">;

// ── 内部ヘルパー ──

/** タイマーの所有権チェック */
async function getOwnedTimer(timerId: number, userId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(timers)
    .where(and(eq(timers.id, timerId), eq(timers.user_id, userId)))
    .limit(1);
  if (rows.length === 0) throw new Error("not_found_or_forbidden");
  return rows[0];
}

/**
 * running 中のタイマーが 0 以下なら自動停止する。
 * 全クライアントが閉じていても DB の正しさを保証する。
 */
async function autoStopIfExpired(
  timer: typeof timers.$inferSelect,
): Promise<typeof timers.$inferSelect> {
  if (!timer.running || !timer.started_at) return timer;
  const elapsed = Math.floor((Date.now() - timer.started_at.getTime()) / 1000);
  const remaining = timer.remaining_seconds - elapsed;
  if (remaining > 0) return timer;
  // 期限切れ → 自動停止
  const db = getDb();
  await db
    .update(timers)
    .set({
      running: 0,
      expired: 1,
      remaining_seconds: 0,
      started_at: null,
      updated: new Date(),
    })
    .where(eq(timers.id, timer.id));
  return {
    ...timer,
    running: 0,
    expired: 1,
    remaining_seconds: 0,
    started_at: null,
  };
}

/** DB の timer 行を TimerInfo に変換する */
function toTimerInfo(row: typeof timers.$inferSelect): TimerInfo {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode as "countdown" | "alarm",
    target_minutes: row.target_minutes,
    base_seconds: row.base_seconds,
    adjust_minutes: row.adjust_minutes,
    running: row.running === 1,
    expired: row.expired === 1,
    ephemeral: row.ephemeral === 1,
    ring_seconds: row.ring_seconds,
    remaining_seconds: row.remaining_seconds,
    started_at: row.started_at ? toUtcIso(row.started_at) : null,
    sort_order: row.sort_order,
  };
}

// テスト目的でexport。本来はモジュール内部関数。api.ts バレルからのre-exportは行わない。

/** target_minutes と tz_offset から remaining_seconds を計算する（サーバー側 UTC 基準） */
export function calcAlarmRemainingSeconds(
  targetMinutes: number,
  tzOffsetMinutes: number,
): number {
  const nowUtcMs = Date.now();
  const nowLocal = new Date(nowUtcMs + tzOffsetMinutes * 60 * 1000);
  const nowLocalMinutes =
    nowLocal.getUTCHours() * 60 + nowLocal.getUTCMinutes();
  const nowLocalSeconds = nowLocal.getUTCSeconds();
  let diffMinutes = targetMinutes - nowLocalMinutes;
  if (diffMinutes < 0 || (diffMinutes === 0 && nowLocalSeconds > 0)) {
    diffMinutes += 24 * 60;
  }
  return diffMinutes * 60 - nowLocalSeconds;
}

/**
 * アラームモード用の共通バリデーションと remaining_seconds 計算をまとめたヘルパー。
 *
 * target_minutes または tzOffsetMinutes が未指定の場合は alarm_missing_params を throw する。
 * 有効な場合は計算した remaining_seconds を返す。
 */
export function calcAlarmSecondsOrThrow(
  targetMinutes: number | null | undefined,
  tzOffsetMinutes: number | null | undefined,
): number {
  if (targetMinutes === null || targetMinutes === undefined) {
    throw new Error("alarm_missing_params");
  }
  if (tzOffsetMinutes === null || tzOffsetMinutes === undefined) {
    throw new Error("alarm_missing_params");
  }
  return calcAlarmRemainingSeconds(targetMinutes, tzOffsetMinutes);
}

// ── 公開API ──

/** タイマー一覧取得 + サーバー時刻返却 */
export async function getTimers(
  userId: number,
): Promise<{ timers: TimerInfo[]; server_time: string }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(timers)
    .where(eq(timers.user_id, userId))
    .orderBy(timers.sort_order, timers.created);
  // 期限切れタイマーを自動停止
  const processed = await Promise.all(rows.map(autoStopIfExpired));
  return {
    timers: processed.map(toTimerInfo),
    server_time: new Date().toISOString(),
  };
}

/** タイマーを作成する（sort_order は既存の最大値 + 1000 で末尾追加） */
export async function createTimer(params: {
  userId: number;
  name: string;
  baseSeconds: number;
  adjustMinutes: number;
  mode?: string;
  targetMinutes?: number | null;
  tzOffsetMinutes?: number | null;
  ephemeral?: boolean;
  ringSeconds?: number;
}): Promise<void> {
  const {
    userId,
    name,
    baseSeconds,
    adjustMinutes,
    mode = "countdown",
    targetMinutes = null,
    tzOffsetMinutes = null,
    ephemeral = false,
    ringSeconds = TIMER_DEFAULT_RING_SECONDS,
  } = params;
  const isAlarm = mode === "alarm";
  const remainingSeconds = isAlarm
    ? calcAlarmSecondsOrThrow(targetMinutes, tzOffsetMinutes)
    : baseSeconds;
  const db = getDb();
  const now = new Date();
  // 現在の最大 sort_order を取得
  const [{ maxOrder }] = await db
    .select({ maxOrder: max(timers.sort_order) })
    .from(timers)
    .where(eq(timers.user_id, userId));
  const sortOrder = (maxOrder ?? 0) + 1000;
  await db.insert(timers).values({
    user_id: userId,
    name,
    mode,
    base_seconds: isAlarm ? 0 : baseSeconds,
    adjust_minutes: adjustMinutes,
    remaining_seconds: remainingSeconds,
    target_minutes: targetMinutes,
    running: isAlarm ? 1 : 0,
    ephemeral: ephemeral ? 1 : 0,
    ring_seconds: ringSeconds,
    started_at: isAlarm ? now : null,
    sort_order: sortOrder,
    created: now,
    updated: now,
  });
}

/** タイマー設定を変更する */
export async function updateTimer(
  userId: number,
  timerId: number,
  data: UpdateTimerData,
): Promise<void> {
  const timer = await getOwnedTimer(timerId, userId);
  const db = getDb();
  const updates: Partial<typeof timers.$inferInsert> = { updated: new Date() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.adjust_minutes !== undefined)
    updates.adjust_minutes = data.adjust_minutes;
  if (data.ring_seconds !== undefined) updates.ring_seconds = data.ring_seconds;

  // モード変更処理
  if (data.mode !== undefined && data.mode !== timer.mode) {
    if (timer.running) throw new Error("timer_is_running");
    updates.mode = data.mode;
    updates.expired = 0;
    if (data.mode === "alarm") {
      updates.target_minutes = data.target_minutes;
      updates.base_seconds = 0;
      updates.remaining_seconds = calcAlarmSecondsOrThrow(
        data.target_minutes,
        data.tz_offset_minutes,
      );
    } else {
      // alarm → countdown
      if (data.base_seconds === undefined)
        throw new Error("countdown_missing_base_seconds");
      updates.base_seconds = data.base_seconds;
      updates.target_minutes = null;
      updates.remaining_seconds = data.base_seconds;
    }
  } else {
    // モード変更なしの場合
    if (data.base_seconds !== undefined)
      updates.base_seconds = data.base_seconds;
    if (data.target_minutes !== undefined) {
      updates.target_minutes = data.target_minutes;
      // アラームモードで target_minutes を変更した場合は remaining_seconds も再計算
      if (
        (data.mode ?? timer.mode) === "alarm" &&
        data.tz_offset_minutes !== undefined
      ) {
        updates.remaining_seconds = calcAlarmRemainingSeconds(
          data.target_minutes,
          data.tz_offset_minutes,
        );
      }
    }
  }

  await db.update(timers).set(updates).where(eq(timers.id, timerId));
}

/** タイマーを削除する */
export async function deleteTimer(
  userId: number,
  timerId: number,
): Promise<void> {
  // 冪等な削除: 対象が無い・他ユーザーのものは no-op (NOT_FOUND を返さない)。
  // 別端末で先に削除されていた場合のレース時に、こちらの削除がエラーにならず
  // クライアントの状態を確実に整合させるため。
  const db = getDb();
  await db
    .delete(timers)
    .where(and(eq(timers.id, timerId), eq(timers.user_id, userId)));
}

/** タイマーを開始する */
export async function startTimer(
  userId: number,
  timerId: number,
  tzOffsetMinutes?: number,
): Promise<void> {
  const timer = await getOwnedTimer(timerId, userId);
  if (timer.running) return;
  const now = new Date();
  const db = getDb();

  if (timer.mode === "alarm") {
    const remaining = calcAlarmSecondsOrThrow(
      timer.target_minutes,
      tzOffsetMinutes,
    );
    if (remaining <= 0) return;
    await db
      .update(timers)
      .set({
        running: 1,
        expired: 0,
        remaining_seconds: remaining,
        started_at: now,
        updated: now,
      })
      .where(eq(timers.id, timerId));
  } else {
    if (timer.remaining_seconds <= 0) return;
    await db
      .update(timers)
      .set({ running: 1, expired: 0, started_at: now, updated: now })
      .where(eq(timers.id, timerId));
  }
}

/** タイマーを一時停止する */
export async function pauseTimer(
  userId: number,
  timerId: number,
): Promise<void> {
  const timer = await getOwnedTimer(timerId, userId);
  if (!timer.running || !timer.started_at) return;
  const elapsed = Math.floor((Date.now() - timer.started_at.getTime()) / 1000);
  const remaining = Math.max(0, timer.remaining_seconds - elapsed);
  const db = getDb();
  await db
    .update(timers)
    .set({
      running: 0,
      expired: remaining === 0 ? 1 : 0,
      remaining_seconds: remaining,
      started_at: null,
      updated: new Date(),
    })
    .where(eq(timers.id, timerId));
}

/**
 * タイマーをリセットする（トグル動作）。
 * - カウントダウン: running中 or 途中使用中 → base_seconds に戻す / base_seconds と一致 → 0 にクリア
 * - アラーム: 次のターゲット時刻までの秒数をサーバー側で再計算
 */
export async function resetTimer(
  userId: number,
  timerId: number,
  tzOffsetMinutes?: number,
): Promise<void> {
  const timer = await getOwnedTimer(timerId, userId);
  let newRemaining: number;

  if (timer.mode === "alarm") {
    newRemaining = calcAlarmSecondsOrThrow(
      timer.target_minutes,
      tzOffsetMinutes,
    );
  } else {
    let currentRemaining = timer.remaining_seconds;
    if (timer.running && timer.started_at) {
      const elapsed = Math.floor(
        (Date.now() - timer.started_at.getTime()) / 1000,
      );
      currentRemaining = Math.max(0, timer.remaining_seconds - elapsed);
    }
    // トグルロジック: base_seconds と一致 → 0、それ以外 → base_seconds
    newRemaining =
      !timer.running && currentRemaining === timer.base_seconds
        ? 0
        : timer.base_seconds;
  }

  const db = getDb();
  await db
    .update(timers)
    .set({
      running: 0,
      expired: 0,
      remaining_seconds: newRemaining,
      started_at: null,
      updated: new Date(),
    })
    .where(eq(timers.id, timerId));
}

/** タイマーの残り時間を延長/削減する */
export async function adjustTimer(
  userId: number,
  timerId: number,
  minutes: number,
): Promise<void> {
  const timer = await getOwnedTimer(timerId, userId);
  let currentRemaining = timer.remaining_seconds;
  // running 中は経過時間を考慮
  if (timer.running && timer.started_at) {
    const elapsed = Math.floor(
      (Date.now() - timer.started_at.getTime()) / 1000,
    );
    currentRemaining -= elapsed;
  }
  const newRemaining = Math.max(0, currentRemaining + minutes * 60);
  // アラームモード: target_minutes も連動して更新
  const targetMinutesUpdate =
    timer.mode === "alarm" && timer.target_minutes !== null
      ? (((timer.target_minutes + minutes) % 1440) + 1440) % 1440
      : undefined;
  const db = getDb();
  if (timer.running && timer.started_at) {
    // running 中: started_at を現在時刻にリセットし、remaining_seconds を新しい値に
    const runningUpdates: Partial<typeof timers.$inferInsert> = {
      remaining_seconds: newRemaining,
      started_at: newRemaining > 0 ? new Date() : null,
      running: newRemaining > 0 ? 1 : 0,
      expired: 0,
      updated: new Date(),
    };
    if (targetMinutesUpdate !== undefined)
      runningUpdates.target_minutes = targetMinutesUpdate;
    await db.update(timers).set(runningUpdates).where(eq(timers.id, timerId));
  } else {
    const stoppedUpdates: Partial<typeof timers.$inferInsert> = {
      remaining_seconds: newRemaining,
      expired: 0,
      updated: new Date(),
    };
    if (targetMinutesUpdate !== undefined)
      stoppedUpdates.target_minutes = targetMinutesUpdate;
    await db.update(timers).set(stoppedUpdates).where(eq(timers.id, timerId));
  }
}

/**
 * タイマーを停止する（0秒到達時）。
 * startedAt が指定された場合、タイマーがリセット/再開されていないことを確認する。
 * これにより、遅延した stop リクエストが新しいセッションを上書きするのを防ぐ。
 */
export async function stopTimer(
  userId: number,
  timerId: number,
  startedAt?: string | null,
): Promise<void> {
  const timer = await getOwnedTimer(timerId, userId);
  // started_at が指定された場合、タイマーがリセット/再開されていないことを確認
  if (startedAt !== undefined) {
    const currentStartedAt = timer.started_at
      ? timer.started_at.toISOString()
      : null;
    if (currentStartedAt !== startedAt) return;
  }
  if (!timer.running) return;
  const db = getDb();
  await db
    .update(timers)
    .set({
      running: 0,
      expired: 1,
      remaining_seconds: 0,
      started_at: null,
      updated: new Date(),
    })
    .where(eq(timers.id, timerId));
}

/** タイマーの残り時間を直接設定する（停止中のみ） */
export async function setTimerTime(
  userId: number,
  timerId: number,
  seconds: number,
  targetMinutes?: number,
  tzOffsetMinutes?: number,
): Promise<void> {
  const timer = await getOwnedTimer(timerId, userId);
  if (timer.running) throw new Error("timer_is_running");
  const db = getDb();
  const updates: Partial<typeof timers.$inferInsert> = {
    expired: 0,
    updated: new Date(),
  };
  if (targetMinutes !== undefined && timer.mode === "alarm") {
    updates.target_minutes = targetMinutes;
    if (tzOffsetMinutes !== undefined) {
      updates.remaining_seconds = calcAlarmRemainingSeconds(
        targetMinutes,
        tzOffsetMinutes,
      );
    } else {
      updates.remaining_seconds = seconds;
    }
  } else {
    updates.remaining_seconds = seconds;
  }
  await db.update(timers).set(updates).where(eq(timers.id, timerId));
}

/** タイマーの並び順を更新する（全件一致を検証） */
export async function reorderTimers(
  userId: number,
  timerIds: number[],
): Promise<void> {
  const db = getDb();
  // ユーザーの全タイマーIDを取得して全件一致を検証
  const owned = await db
    .select({ id: timers.id })
    .from(timers)
    .where(eq(timers.user_id, userId));
  const ownedIds = new Set(owned.map((r) => r.id));
  if (
    timerIds.length !== ownedIds.size ||
    !timerIds.every((id) => ownedIds.has(id))
  ) {
    throw new Error("invalid_timer_ids");
  }
  // timerIds の順に sort_order を 0, 1000, 2000... で再割当
  // 依存関係のないタイマーを並列更新し、直列実行による RTT の線形増大を回避する
  await Promise.all(
    timerIds.map((id, i) =>
      db
        .update(timers)
        .set({ sort_order: i * 1000 })
        .where(and(eq(timers.id, id), eq(timers.user_id, userId))),
    ),
  );
}
