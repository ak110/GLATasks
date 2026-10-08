/**
 * @fileoverview TimerCard コンポーネントのsmoke test
 *
 * マウントできて主要要素（タイマー名・操作ボタン）が表示されることを確認する。
 * タイマーの表示秒数は内部 setInterval に依存するため、ここでは要素の存在のみを検証する。
 */

import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import type { TimerInfo } from "#lib/types.ts";
import TimerCard from "./TimerCard.svelte";

/** テスト用タイマーデータのデフォルト値 */
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

/** TimerCard に必要な最小限の props */
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
  it("タイマー名が表示される", () => {
    render(TimerCard, { props: makeDefaultProps({ name: "集中タイマー" }) });
    expect(screen.getByText("集中タイマー")).toBeInTheDocument();
  });

  it("停止中のカウントダウンタイマーで開始ボタンが表示される", () => {
    render(TimerCard, { props: makeDefaultProps({ running: false }) });
    expect(screen.getByTestId("timer-start-btn")).toBeInTheDocument();
  });

  it("リセットボタンが表示される", () => {
    render(TimerCard, { props: makeDefaultProps() });
    expect(screen.getByTestId("timer-reset-btn")).toBeInTheDocument();
  });
});
