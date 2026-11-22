import { ApiError } from "../api-errors";

import { and, eq, max } from "drizzle-orm";
import type { z } from "zod";

import { TIMER_DEFAULT_RING_SECONDS } from "#lib/schemas.ts";
import type { CreateTimerSchema, UpdateTimerSchema } from "#lib/schemas.ts";
import { getDb } from "../db";
import { timers } from "../schema";
import { toUtcIso } from "./common";
import {
  decodeTimerState,
  initialTimerState,
  timerStateColumns,
  timerRemainingSeconds,
  transitionTimer,
} from "../timer-state.ts";

export type TimerInfo = ReturnType<typeof toTimerInfo>;
type CreateTimerParams = z.infer<typeof CreateTimerSchema> & { userId: number };
type UpdateTimerParams = Omit<z.infer<typeof UpdateTimerSchema>, "timerId">;
type TimerConnection =
  | ReturnType<typeof getDb>
  | Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function getOwnedTimer(
  timerId: number,
  userId: number,
  db: TimerConnection,
) {
  const rows = await db
    .select()
    .from(timers)
    .where(and(eq(timers.id, timerId), eq(timers.user_id, userId)))
    .limit(1)
    .for("update");
  if (rows.length === 0) throw new ApiError("not_found_or_forbidden");
  return rows[0];
}

async function changeTimer(
  userId: number,
  timerId: number,
  change: (
    timer: typeof timers.$inferSelect,
    now: Date,
  ) => Partial<typeof timers.$inferInsert>,
) {
  await getDb().transaction(async (db) => {
    const timer = await getOwnedTimer(timerId, userId, db);
    await db
      .update(timers)
      .set({ ...change(timer, new Date()), updated: new Date() })
      .where(eq(timers.id, timerId));
  });
}

async function autoStopIfExpired(
  timer: typeof timers.$inferSelect,
  db: TimerConnection,
): Promise<typeof timers.$inferSelect> {
  const state = decodeTimerState(timer);
  const next = transitionTimer(state, { kind: "autoExpire" }, new Date());
  if (next === state) return timer;
  await db
    .update(timers)
    .set({
      ...timerStateColumns(next),
      updated: new Date(),
    })
    .where(eq(timers.id, timer.id));
  return {
    ...timer,
    ...timerStateColumns(next),
  };
}

function toTimerInfo(row: typeof timers.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    targetMinutes: row.target_minutes,
    baseSeconds: row.base_seconds,
    adjustMinutes: row.adjust_minutes,
    running: row.running === 1,
    expired: row.expired === 1,
    ephemeral: row.ephemeral === 1,
    ringSeconds: row.ring_seconds,
    remainingSeconds: row.remaining_seconds,
    startedAt: row.started_at ? toUtcIso(row.started_at) : null,
    sortOrder: row.sort_order,
  };
}

export function calcAlarmRemainingSeconds(
  targetMinutes: number,
  tzOffsetMinutes: number,
  nowUtcMs: number,
): number {
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

export function calcAlarmSecondsOrThrow(
  targetMinutes: number | null | undefined,
  tzOffsetMinutes: number | null | undefined,
  nowUtcMs: number,
): number {
  if (targetMinutes === null || targetMinutes === undefined) {
    throw new ApiError("alarm_missing_params");
  }
  if (tzOffsetMinutes === null || tzOffsetMinutes === undefined) {
    throw new ApiError("alarm_missing_params");
  }
  return calcAlarmRemainingSeconds(targetMinutes, tzOffsetMinutes, nowUtcMs);
}

export async function listTimers(
  userId: number,
): Promise<{ timers: TimerInfo[]; serverTime: string }> {
  return getDb().transaction(async (db) => {
    const rows = await db
      .select()
      .from(timers)
      .where(eq(timers.user_id, userId))
      .orderBy(timers.sort_order, timers.created)
      .for("update");
    const processed = await Promise.all(
      rows.map((timer) => autoStopIfExpired(timer, db)),
    );
    return {
      timers: processed.map(toTimerInfo),
      serverTime: new Date().toISOString(),
    };
  });
}

export async function createTimer(params: CreateTimerParams): Promise<void> {
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
  const startsImmediately = isAlarm || ephemeral;
  const now = new Date();
  const remainingSeconds = isAlarm
    ? calcAlarmRemainingSeconds(targetMinutes!, tzOffsetMinutes!, now.getTime())
    : baseSeconds;
  const db = getDb();
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
    ...timerStateColumns(
      initialTimerState(remainingSeconds, startsImmediately ? now : undefined),
    ),
    target_minutes: targetMinutes,
    ephemeral: ephemeral ? 1 : 0,
    ring_seconds: ringSeconds,
    sort_order: sortOrder,
    created: now,
    updated: now,
  });
}

export async function updateTimer(
  userId: number,
  timerId: number,
  data: UpdateTimerParams,
): Promise<void> {
  await changeTimer(userId, timerId, (timer, now) => {
    const state = decodeTimerState(timer);
    const updates: Partial<typeof timers.$inferSelect> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.adjustMinutes !== undefined)
      updates.adjust_minutes = data.adjustMinutes;
    if (data.ringSeconds !== undefined) updates.ring_seconds = data.ringSeconds;

    if (data.mode !== undefined && data.mode !== timer.mode) {
      if (state.kind === "running") throw new ApiError("timer_is_running");
      updates.mode = data.mode;
      if (data.mode === "alarm") {
        updates.target_minutes = data.targetMinutes;
        updates.base_seconds = 0;
        updates.remaining_seconds = calcAlarmRemainingSeconds(
          data.targetMinutes!,
          data.tzOffsetMinutes!,
          now.getTime(),
        );
      } else {
        if (data.baseSeconds === undefined)
          throw new ApiError("countdown_missing_base_seconds");
        updates.base_seconds = data.baseSeconds;
        updates.target_minutes = null;
        updates.remaining_seconds = data.baseSeconds;
      }
    } else {
      if (data.baseSeconds !== undefined)
        updates.base_seconds = data.baseSeconds;
      if (data.targetMinutes !== undefined) {
        updates.target_minutes = data.targetMinutes;
        if (
          (data.mode ?? timer.mode) === "alarm" &&
          data.tzOffsetMinutes !== undefined
        ) {
          updates.remaining_seconds = calcAlarmRemainingSeconds(
            data.targetMinutes,
            data.tzOffsetMinutes,
            now.getTime(),
          );
        }
      }
    }
    if (updates.remaining_seconds !== undefined) {
      const seconds = updates.remaining_seconds;
      const next =
        state.kind === "running"
          ? { ...state, remainingSeconds: seconds }
          : transitionTimer(state, { kind: "set", seconds }, now);
      Object.assign(updates, timerStateColumns(next));
    }
    return updates;
  });
}

export async function deleteTimer(
  userId: number,
  timerId: number,
): Promise<void> {
  // 削除の規約は .claude/skills/add-trpc-procedure/SKILL.md「DB層の実装」を参照。
  const db = getDb();
  await db
    .delete(timers)
    .where(and(eq(timers.id, timerId), eq(timers.user_id, userId)));
}

export async function startTimer(
  userId: number,
  timerId: number,
  tzOffsetMinutes?: number,
): Promise<void> {
  await changeTimer(userId, timerId, (timer, now) => {
    const state = decodeTimerState(timer);
    const alarmSeconds =
      timer.mode === "alarm" && state.kind !== "running"
        ? calcAlarmSecondsOrThrow(
            timer.target_minutes,
            tzOffsetMinutes,
            now.getTime(),
          )
        : undefined;
    return timerStateColumns(
      transitionTimer(state, { kind: "start", alarmSeconds }, now),
    );
  });
}

export async function pauseTimer(
  userId: number,
  timerId: number,
): Promise<void> {
  await changeTimer(userId, timerId, (timer, now) =>
    timerStateColumns(
      transitionTimer(decodeTimerState(timer), { kind: "pause" }, now),
    ),
  );
}

export async function resetTimer(
  userId: number,
  timerId: number,
  tzOffsetMinutes?: number,
): Promise<void> {
  await changeTimer(userId, timerId, (timer, now) => {
    const state = decodeTimerState(timer);
    let newRemaining: number;

    if (timer.mode === "alarm") {
      newRemaining = calcAlarmSecondsOrThrow(
        timer.target_minutes,
        tzOffsetMinutes,
        now.getTime(),
      );
    } else {
      const currentRemaining = Math.max(0, timerRemainingSeconds(state, now));
      newRemaining =
        state.kind !== "running" && currentRemaining === timer.base_seconds
          ? 0
          : timer.base_seconds;
    }

    return timerStateColumns(
      transitionTimer(state, { kind: "reset", seconds: newRemaining }, now),
    );
  });
}

export async function adjustTimer(
  userId: number,
  timerId: number,
  minutes: number,
): Promise<void> {
  await changeTimer(userId, timerId, (timer, now) => {
    const targetMinutesUpdate =
      timer.mode === "alarm" && timer.target_minutes !== null
        ? (((timer.target_minutes + minutes) % 1440) + 1440) % 1440
        : undefined;
    return {
      ...timerStateColumns(
        transitionTimer(
          decodeTimerState(timer),
          { kind: "adjust", minutes },
          now,
        ),
      ),
      ...(targetMinutesUpdate === undefined
        ? {}
        : { target_minutes: targetMinutesUpdate }),
    };
  });
}

export async function stopTimer(
  userId: number,
  timerId: number,
  startedAt?: string | null,
): Promise<void> {
  await changeTimer(userId, timerId, (timer, now) =>
    timerStateColumns(
      transitionTimer(
        decodeTimerState(timer),
        { kind: "expire", startedAt },
        now,
      ),
    ),
  );
}

export async function setTimerTime(
  userId: number,
  timerId: number,
  seconds: number,
  targetMinutes?: number,
  tzOffsetMinutes?: number,
): Promise<void> {
  await changeTimer(userId, timerId, (timer, now) => {
    const updates: Partial<typeof timers.$inferSelect> = {
      ...timerStateColumns(
        transitionTimer(decodeTimerState(timer), { kind: "set", seconds }, now),
      ),
    };
    if (targetMinutes !== undefined && timer.mode === "alarm") {
      updates.target_minutes = targetMinutes;
      if (tzOffsetMinutes !== undefined) {
        updates.remaining_seconds = calcAlarmRemainingSeconds(
          targetMinutes,
          tzOffsetMinutes,
          now.getTime(),
        );
      } else {
        updates.remaining_seconds = seconds;
      }
    } else {
      updates.remaining_seconds = seconds;
    }
    return updates;
  });
}

export async function reorderTimers(
  userId: number,
  timerIds: number[],
): Promise<void> {
  await getDb().transaction(async (db) => {
    const owned = await db
      .select({ id: timers.id })
      .from(timers)
      .where(eq(timers.user_id, userId))
      .for("update");
    const ownedIds = new Set(owned.map((r) => r.id));
    if (
      timerIds.length !== ownedIds.size ||
      !timerIds.every((id) => ownedIds.has(id))
    ) {
      throw new ApiError("invalid_timer_ids");
    }
    await Promise.all(
      timerIds.map((id, i) =>
        db
          .update(timers)
          .set({ sort_order: i * 1000 })
          .where(and(eq(timers.id, id), eq(timers.user_id, userId))),
      ),
    );
  });
}
