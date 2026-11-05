import { ApiError } from "./api-errors.ts";
import type { timers } from "./schema.ts";

export type TimerState =
  | { kind: "stopped"; remainingSeconds: number }
  | { kind: "running"; remainingSeconds: number; startedAt: Date }
  | { kind: "expired" };

type TimerRow = typeof timers.$inferSelect;

export function initialTimerState(
  remainingSeconds: number,
  startedAt?: Date,
): TimerState {
  return startedAt
    ? { kind: "running", remainingSeconds, startedAt }
    : { kind: "stopped", remainingSeconds };
}

export function decodeTimerState(row: TimerRow): TimerState {
  if (row.running && row.started_at) {
    return {
      kind: "running",
      remainingSeconds: row.remaining_seconds,
      startedAt: row.started_at,
    };
  }
  return row.expired
    ? { kind: "expired" }
    : { kind: "stopped", remainingSeconds: row.remaining_seconds };
}

export function timerStateColumns(state: TimerState) {
  return {
    running: state.kind === "running" ? 1 : 0,
    expired: state.kind === "expired" ? 1 : 0,
    remaining_seconds: state.kind === "expired" ? 0 : state.remainingSeconds,
    started_at: state.kind === "running" ? state.startedAt : null,
  };
}

/** 延長時には期限超過分も差し引くため、負の残秒数を保つ。 */
export function timerRemainingSeconds(state: TimerState, now: Date): number {
  if (state.kind === "expired") return 0;
  return (
    state.remainingSeconds -
    (state.kind === "running"
      ? Math.floor((now.getTime() - state.startedAt.getTime()) / 1000)
      : 0)
  );
}

type TimerTransition =
  | { kind: "start"; alarmSeconds?: number }
  | { kind: "pause" }
  | { kind: "expire"; startedAt?: string | null }
  | { kind: "autoExpire" }
  | { kind: "reset"; seconds: number }
  | { kind: "set"; seconds: number }
  | { kind: "adjust"; minutes: number };

export function transitionTimer(
  state: TimerState,
  action: TimerTransition,
  now: Date,
): TimerState {
  switch (action.kind) {
    case "start": {
      if (state.kind === "running") return state;
      const seconds = action.alarmSeconds ?? timerRemainingSeconds(state, now);
      return seconds > 0
        ? { kind: "running", remainingSeconds: seconds, startedAt: now }
        : state;
    }
    case "pause": {
      if (state.kind !== "running") return state;
      const seconds = Math.max(0, timerRemainingSeconds(state, now));
      return seconds === 0
        ? { kind: "expired" }
        : { kind: "stopped", remainingSeconds: seconds };
    }
    case "autoExpire":
      return state.kind === "running" && timerRemainingSeconds(state, now) <= 0
        ? { kind: "expired" }
        : state;
    case "expire":
      if (state.kind !== "running") return state;
      if (
        action.startedAt !== undefined &&
        state.startedAt.toISOString() !== action.startedAt
      )
        return state;
      return { kind: "expired" };
    case "set":
      if (state.kind === "running") throw new ApiError("timer_is_running");
      return { kind: "stopped", remainingSeconds: action.seconds };
    case "reset":
      return { kind: "stopped", remainingSeconds: action.seconds };
    case "adjust": {
      const seconds = Math.max(
        0,
        timerRemainingSeconds(state, now) + action.minutes * 60,
      );
      return state.kind === "running" && seconds > 0
        ? { kind: "running", remainingSeconds: seconds, startedAt: now }
        : { kind: "stopped", remainingSeconds: seconds };
    }
  }
}
