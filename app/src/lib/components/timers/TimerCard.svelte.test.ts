import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import type { TimerInfo } from "#lib/types.ts";
import TimerCard from "./TimerCard.svelte";

function makeTimer(overrides?: Partial<TimerInfo>): TimerInfo {
  return {
    id: 1,
    name: "テストタイマー",
    mode: "countdown",
    targetMinutes: null,
    baseSeconds: 1800,
    adjustMinutes: 10,
    running: false,
    expired: false,
    ephemeral: false,
    ringSeconds: 3,
    remainingSeconds: 1800,
    startedAt: null,
    sortOrder: 1000,
    ...overrides,
  };
}

function makeDefaultProps(overrides?: Partial<TimerInfo>) {
  return {
    timer: makeTimer(overrides),
    onStart: vi.fn(),
    onPause: vi.fn(),
    onReset: vi.fn(),
    onAdjust: vi.fn(),
    onSetTime: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };
}

describe("TimerCard", () => {
  it("カウントダウンの名前と操作を表示し、実行中は開始を隠す", async () => {
    const props = makeDefaultProps({ name: "集中タイマー" });
    const { rerender } = render(TimerCard, { props });
    expect(screen.getByText("集中タイマー")).toBeInTheDocument();
    expect(screen.getByTestId("timer-reset-btn")).toBeInTheDocument();
    expect(screen.getByTestId("timer-start-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("timer-pause-btn")).not.toBeInTheDocument();

    await rerender({
      timer: {
        ...props.timer,
        running: true,
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(screen.getByTestId("timer-pause-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("timer-start-btn")).not.toBeInTheDocument();
  });
});
