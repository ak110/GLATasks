/**
 * @fileoverview カロリー集計カードの表示値と色境界テスト
 */

import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import CalorieSummary from "./CalorieSummary.svelte";

describe("CalorieSummary", () => {
  it.each([
    [95.04, "bg-sky-100"],
    [95.05, "bg-white"],
    [105.04, "bg-white"],
    [105.05, "bg-yellow-100"],
    [110.04, "bg-yellow-100"],
    [110.05, "bg-red-100"],
  ] as const)("丸め後の割合 %s に対応する色を使う", (raw, color) => {
    const percentage = Math.round(raw * 10) / 10;
    const { getByTestId } = render(CalorieSummary, {
      periods: [{ days: 1, total_kcal: 100, percentage }],
      goalKcal: 1615,
      onSaveGoal: vi.fn(),
    });
    expect(getByTestId("calorie-summary-1")).toHaveClass(color);
  });

  it("合計と割合だけを表示し、上下判定の状態文言を追加しない", () => {
    const { getByTestId, queryByText } = render(CalorieSummary, {
      periods: [{ days: 1, total_kcal: 1615, percentage: 100 }],
      goalKcal: 1615,
      onSaveGoal: vi.fn(),
    });
    expect(getByTestId("calorie-summary-1")).toHaveTextContent("1,615");
    expect(getByTestId("calorie-summary-1")).toHaveTextContent("100.0%");
    expect(queryByText(/上回|下回/)).not.toBeInTheDocument();
  });

  it("既定の整数目標値を妥当な値として保存できる", async () => {
    const onSaveGoal = vi.fn();
    const { getByLabelText, getByRole } = render(CalorieSummary, {
      periods: [],
      goalKcal: 1615,
      onSaveGoal,
    });
    const goalInput = getByLabelText("1日目標") as HTMLInputElement;

    expect(goalInput.validity.stepMismatch).toBe(false);
    expect(goalInput.checkValidity()).toBe(true);
    await fireEvent.click(getByRole("button", { name: "保存" }));
    expect(onSaveGoal).toHaveBeenCalledWith(1615);
  });
});
