/**
 * @fileoverview カロリーの達成状況の表示条件テスト
 */

import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import CalorieAchievement from "./CalorieAchievement.svelte";

type Status = "achieved" | "missed" | "unrated";

/** 古い順の区分から28確定日分の達成状況を組み立てる（不足分は先頭を判定対象外で埋める） */
function makeAchievement(
  latestStatuses: Status[],
  overrides: {
    streak_days?: number;
    latest_average_kcal?: number | null;
    weekly_change_kcal?: number | null;
    today_remaining_kcal?: number | null;
  } = {},
) {
  const statuses: Status[] = [
    ...Array.from(
      { length: 28 - latestStatuses.length },
      () => "unrated" as const,
    ),
    ...latestStatuses,
  ];
  return {
    days: statuses.map((status, index) => ({
      date: `2026/08/${String(index + 4).padStart(2, "0")}`,
      average_kcal: status === "unrated" ? null : 1500,
      status,
    })),
    streak_days: 0,
    latest_average_kcal: 1500,
    weekly_change_kcal: null,
    today_remaining_kcal: null,
    ...overrides,
  };
}

describe("CalorieAchievement", () => {
  it("28確定日を区分ごとの点で新しい順に表示する", () => {
    const { getAllByTestId } = render(CalorieAchievement, {
      achievement: makeAchievement(["missed", "achieved"], { streak_days: 1 }),
    });

    const days = getAllByTestId("calorie-achievement-day");
    expect(days).toHaveLength(28);
    expect(days[0]).toHaveAttribute("data-status", "achieved");
    expect(days[1]).toHaveAttribute("data-status", "missed");
    expect(days[27]).toHaveAttribute("data-status", "unrated");
    expect(days[0]).toHaveAccessibleName(
      "2026/08/31 7日平均 1,500 kcal 目標内",
    );
    expect(days[27]).toHaveAccessibleName("2026/08/04 判定対象外");
  });

  it("昨日が達成日なら連続日数を表示し、配色を緑系へ変える", () => {
    const { getByTestId } = render(CalorieAchievement, {
      achievement: makeAchievement(["achieved", "achieved", "achieved"], {
        streak_days: 3,
      }),
    });

    const block = getByTestId("calorie-achievement");
    expect(block).toHaveAttribute("data-achieved", "true");
    expect(block).toHaveClass("bg-emerald-50");
    expect(getByTestId("calorie-achievement-streak")).toHaveTextContent(
      "3日連続で目標内",
    );
  });

  it("28確定日すべてが達成なら28日以上と表示する", () => {
    const { getByTestId } = render(CalorieAchievement, {
      achievement: makeAchievement(
        Array.from({ length: 28 }, () => "achieved" as const),
        { streak_days: 28 },
      ),
    });

    expect(getByTestId("calorie-achievement-streak")).toHaveTextContent(
      "28日以上連続で目標内",
    );
  });

  it("昨日が未達なら連続日数を表示せず、既定の配色にする", () => {
    const { getByTestId, queryByTestId } = render(CalorieAchievement, {
      achievement: makeAchievement(["achieved", "missed"]),
    });

    const block = getByTestId("calorie-achievement");
    expect(block).toHaveAttribute("data-achieved", "false");
    expect(block).not.toHaveClass("bg-emerald-50");
    expect(queryByTestId("calorie-achievement-streak")).not.toBeInTheDocument();
  });

  it("昨日までの7日平均は表示せず、判定前だけ案内を表示する", () => {
    const rated = render(CalorieAchievement, {
      achievement: makeAchievement(["missed"], { latest_average_kcal: 1690 }),
    });
    expect(rated.queryByText(/1,690/)).not.toBeInTheDocument();
    expect(
      rated.queryByTestId("calorie-achievement-guide"),
    ).not.toBeInTheDocument();
    rated.unmount();

    const unrated = render(CalorieAchievement, {
      achievement: makeAchievement([], { latest_average_kcal: null }),
    });
    expect(unrated.getByTestId("calorie-achievement-guide")).toHaveTextContent(
      "記録が7日分たまると判定を始めます",
    );
  });

  it.each([
    [120, "あと 120 kcal"],
    [0, "あと 0 kcal"],
    [-80, "あと -80 kcal"],
    [null, undefined],
  ] as const)("今日の残量 %s を表示する", (remaining, text) => {
    const { queryByTestId } = render(CalorieAchievement, {
      achievement: makeAchievement(["missed"], {
        today_remaining_kcal: remaining,
        weekly_change_kcal: -120,
      }),
    });

    const element = queryByTestId("calorie-achievement-remaining");
    if (text !== undefined) {
      expect(element).toHaveTextContent(text);
    } else {
      expect(element).not.toBeInTheDocument();
    }
    expect(
      queryByTestId("calorie-achievement-weekly-change"),
    ).not.toBeInTheDocument();
  });
});
