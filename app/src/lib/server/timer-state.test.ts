import { expect, it } from "vitest";
import {
  timerStateColumns,
  transitionTimer,
  type TimerState,
} from "./timer-state.ts";

const now = new Date("2026-01-01T00:01:00Z");
const startedAt = new Date("2026-01-01T00:00:00Z");

it.each([
  { seconds: 61, expected: { kind: "stopped", remainingSeconds: 1 } },
  { seconds: 60, expected: { kind: "expired" } },
])(
  "一時停止時の残時間 $seconds 秒は整合する停止状態へ遷移する",
  ({ seconds, expected }) => {
    const state: TimerState = {
      kind: "running",
      remainingSeconds: seconds,
      startedAt,
    };
    const next = transitionTimer(state, { kind: "pause" }, now);
    expect(next).toEqual(expected);
    expect(timerStateColumns(next)).toEqual({
      running: 0,
      expired: seconds === 60 ? 1 : 0,
      remaining_seconds: seconds === 60 ? 0 : 1,
      started_at: null,
    });
  },
);

it("満了後の経過分を延長秒数から差し引いて新しい実行を開始する", () => {
  const next = transitionTimer(
    { kind: "running", remainingSeconds: 30, startedAt },
    { kind: "adjust", minutes: 1 },
    now,
  );
  expect(next).toEqual({
    kind: "running",
    remainingSeconds: 30,
    startedAt: now,
  });
});

it("0への調整は満了通知を作らず、次の時間設定で再開できる", () => {
  const stopped = transitionTimer(
    { kind: "running", remainingSeconds: 30, startedAt },
    { kind: "adjust", minutes: -1 },
    now,
  );
  expect(stopped).toEqual({ kind: "stopped", remainingSeconds: 0 });
  const ready = transitionTimer(stopped, { kind: "set", seconds: 120 }, now);
  expect(transitionTimer(ready, { kind: "start" }, now)).toEqual({
    kind: "running",
    remainingSeconds: 120,
    startedAt: now,
  });
});

it("満了済み状態はリセットで通知対象から解除される", () => {
  const expired = transitionTimer(
    { kind: "running", remainingSeconds: 60, startedAt },
    { kind: "autoExpire" },
    now,
  );
  expect(expired).toEqual({ kind: "expired" });
  const reset = transitionTimer(expired, { kind: "reset", seconds: 60 }, now);
  expect(timerStateColumns(reset)).toEqual({
    running: 0,
    expired: 0,
    remaining_seconds: 60,
    started_at: null,
  });
});
