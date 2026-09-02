/**
 * @fileoverview Zod スキーマのテスト
 */

import { describe, it, expect } from "vitest";
import {
  CalorieItemCsvRowSchema,
  CalorieItemInputSchema,
  CalorieRecordCsvRowSchema,
  CalorieRecordInputSchema,
  CreateTaskSchema,
  CreateTimerSchema,
  SearchTasksSchema,
  TagInfoSchema,
  TaskStatusSchema,
  UpdateTaskSchema,
  UserPreferencesSchema,
} from "./schemas";

describe("TaskStatusSchema / SearchTasksSchema", () => {
  it("running 状態を受け入れる", () => {
    expect(TaskStatusSchema.parse("running")).toBe("running");
  });

  it("検索表示種別の既定値は active で、all も受け入れる", () => {
    expect(SearchTasksSchema.parse({ query: "検索" }).showType).toBe("active");
    expect(
      SearchTasksSchema.parse({ query: "検索", showType: "all" }).showType,
    ).toBe("all");
  });
});

describe("CreateTimerSchema", () => {
  it("ephemeral は未指定だと false になる", () => {
    const parsed = CreateTimerSchema.parse({
      name: "テスト",
      base_seconds: 300,
    });
    expect(parsed.ephemeral).toBe(false);
  });

  it("ephemeral を true にできる", () => {
    const parsed = CreateTimerSchema.parse({
      name: "テスト",
      base_seconds: 300,
      ephemeral: true,
    });
    expect(parsed.ephemeral).toBe(true);
  });

  it("ring_seconds は未指定だと既定値3になる", () => {
    const parsed = CreateTimerSchema.parse({
      name: "テスト",
      base_seconds: 300,
    });
    expect(parsed.ring_seconds).toBe(3);
  });

  it("ring_seconds を1〜3600の範囲で指定できる", () => {
    const parsed = CreateTimerSchema.parse({
      name: "テスト",
      base_seconds: 300,
      ring_seconds: 3600,
    });
    expect(parsed.ring_seconds).toBe(3600);
  });

  it("ring_seconds の0以下を拒否する", () => {
    expect(() =>
      CreateTimerSchema.parse({
        name: "テスト",
        base_seconds: 300,
        ring_seconds: 0,
      }),
    ).toThrow();
  });

  it("ring_seconds の3600超を拒否する", () => {
    expect(() =>
      CreateTimerSchema.parse({
        name: "テスト",
        base_seconds: 300,
        ring_seconds: 3601,
      }),
    ).toThrow();
  });

  it("alarm モードで ephemeral と必須項目を併用できる", () => {
    const parsed = CreateTimerSchema.parse({
      name: "アラーム",
      mode: "alarm",
      base_seconds: 0,
      target_minutes: 600,
      tz_offset_minutes: 540,
      ephemeral: true,
    });
    expect(parsed.ephemeral).toBe(true);
    expect(parsed.mode).toBe("alarm");
  });
});

describe("TagInfoSchema", () => {
  it("正しい色キーのタグを受け入れる", () => {
    const parsed = TagInfoSchema.parse({ name: "仕事", color: "amber" });
    expect(parsed.name).toBe("仕事");
    expect(parsed.color).toBe("amber");
  });

  it("name の前後空白を除去する", () => {
    const parsed = TagInfoSchema.parse({ name: "  緊急  ", color: "red" });
    expect(parsed.name).toBe("緊急");
  });

  it("パレット外の色キーを拒否する", () => {
    expect(() =>
      TagInfoSchema.parse({ name: "無効", color: "purple" }),
    ).toThrow();
  });

  it("空文字列の name を拒否する", () => {
    expect(() => TagInfoSchema.parse({ name: "   ", color: "sky" })).toThrow();
  });
});

describe("UserPreferencesSchema", () => {
  it("空オブジェクトを受け入れる（全フィールドオプショナル）", () => {
    const parsed = UserPreferencesSchema.parse({});
    expect(parsed).toEqual({});
  });

  it("全フィールドを保持する", () => {
    const parsed = UserPreferencesSchema.parse({
      ring_seconds: 1800,
      base_seconds: 600,
      adjust_minutes: 5,
      mode: "alarm",
      calorie_goal_kcal: 1615,
    });
    expect(parsed.ring_seconds).toBe(1800);
    expect(parsed.base_seconds).toBe(600);
    expect(parsed.adjust_minutes).toBe(5);
    expect(parsed.mode).toBe("alarm");
    expect(parsed.calorie_goal_kcal).toBe(1615);
  });

  it("不正な mode を拒否する", () => {
    expect(() => UserPreferencesSchema.parse({ mode: "stopwatch" })).toThrow();
  });

  it("adjust_minutes の範囲外を拒否する", () => {
    expect(() => UserPreferencesSchema.parse({ adjust_minutes: 0 })).toThrow();
    expect(() =>
      UserPreferencesSchema.parse({ adjust_minutes: 1000 }),
    ).toThrow();
  });

  it("ring_seconds の範囲外を拒否する", () => {
    expect(() => UserPreferencesSchema.parse({ ring_seconds: 0 })).toThrow();
    expect(() => UserPreferencesSchema.parse({ ring_seconds: 3601 })).toThrow();
  });

  it("calorie_goal_kcal は正の整数だけを受け入れる", () => {
    expect(UserPreferencesSchema.parse({ calorie_goal_kcal: 1616 })).toEqual({
      calorie_goal_kcal: 1616,
    });
    for (const value of [1.5, 0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() =>
        UserPreferencesSchema.parse({ calorie_goal_kcal: value }),
      ).toThrow();
    }
  });
});

describe("カロリー計算スキーマ", () => {
  it("品目の正の整数kcalを受け入れ、小数と非正数と非有限値を拒否する", () => {
    expect(
      CalorieItemInputSchema.parse({ name: "食品", kcal: 13, note: "" }),
    ).toEqual({ name: "食品", kcal: 13, note: "" });
    for (const kcal of [12.5, 0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() =>
        CalorieItemInputSchema.parse({ name: "食品", kcal, note: "" }),
      ).toThrow();
      expect(() =>
        CalorieItemCsvRowSchema.parse({ name: "食品", kcal, note: "" }),
      ).toThrow();
    }
  });

  it("記録の正の整数数量を受け入れ、小数と非正数を拒否する", () => {
    expect(
      CalorieRecordInputSchema.parse({
        consumed_at: "2026/09/01 12:34",
        item_id: 1,
        quantity: 2,
        tz_offset_minutes: 540,
      }).quantity,
    ).toBe(2);
    for (const quantity of [0.5, 0, -1, Number.NaN]) {
      expect(() =>
        CalorieRecordInputSchema.parse({
          consumed_at: "2026/09/01 12:34",
          item_id: 1,
          quantity,
          tz_offset_minutes: 540,
        }),
      ).toThrow();
      expect(() =>
        CalorieRecordCsvRowSchema.parse({
          consumed_at: "2026/09/01 12:34",
          item_name: "食品",
          quantity,
        }),
      ).toThrow();
    }
  });

  it("分単位の実在日時とUTCオフセットを検証する", () => {
    expect(
      CalorieRecordInputSchema.parse({
        consumed_at: "2026/09/01 12:34",
        item_id: 1,
        quantity: 1,
        tz_offset_minutes: 540,
      }).consumed_at,
    ).toBe("2026/09/01 12:34");
    for (const consumed_at of [
      "2026-09-01 12:34",
      "2026/02/30 12:34",
      "2026/09/01 24:00",
      "2026/09/01 12:34:56",
    ]) {
      expect(() =>
        CalorieRecordInputSchema.parse({
          consumed_at,
          item_id: 1,
          quantity: 1,
          tz_offset_minutes: 540,
        }),
      ).toThrow();
    }
  });
});

describe("CreateTaskSchema / UpdateTaskSchema のタグ対応", () => {
  it("CreateTaskSchema は tags 未指定を許容する", () => {
    const parsed = CreateTaskSchema.parse({ listId: 1, text: "買い物" });
    expect(parsed.tags).toBeUndefined();
  });

  it("CreateTaskSchema は tags 配列を保持する", () => {
    const parsed = CreateTaskSchema.parse({
      listId: 1,
      text: "買い物",
      tags: [{ name: "家事", color: "emerald" }],
    });
    expect(parsed.tags).toEqual([{ name: "家事", color: "emerald" }]);
  });

  it("UpdateTaskSchema は tags だけの更新を許容する", () => {
    const parsed = UpdateTaskSchema.parse({
      listId: 1,
      taskId: 2,
      tags: [{ name: "優先", color: "red" }],
    });
    expect(parsed.tags).toEqual([{ name: "優先", color: "red" }]);
  });

  it("UpdateTaskSchema は更新対象なしを拒否する", () => {
    expect(() => UpdateTaskSchema.parse({ listId: 1, taskId: 2 })).toThrow();
  });
});
