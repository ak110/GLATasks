/**
 * @fileoverview Zod スキーマのテスト
 */

import { describe, it, expect } from "vitest";
import {
  CalorieItemCsvRowSchema,
  CreateCalorieItemSchema,
  CalorieRecordCsvRowSchema,
  CreateCalorieRecordSchema,
  CreateTaskSchema,
  CreateTimerSchema,
  UpdateTimerSchema,
  MAX_TASK_TEXT_BYTES,
  SearchTasksSchema,
  ReorderTasksSchema,
  ReorderTimersSchema,
  TagInfoSchema,
  TaskStatusSchema,
  UpdateCalorieRecordSchema,
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
      baseSeconds: 300,
    });
    expect(parsed.ephemeral).toBe(false);
  });

  it("ephemeral を true にできる", () => {
    const parsed = CreateTimerSchema.parse({
      name: "テスト",
      baseSeconds: 300,
      ephemeral: true,
    });
    expect(parsed.ephemeral).toBe(true);
  });

  it("ringSeconds は未指定だと既定値3になる", () => {
    const parsed = CreateTimerSchema.parse({
      name: "テスト",
      baseSeconds: 300,
    });
    expect(parsed.ringSeconds).toBe(3);
  });

  it("ringSeconds を1〜3600の範囲で指定できる", () => {
    const parsed = CreateTimerSchema.parse({
      name: "テスト",
      baseSeconds: 300,
      ringSeconds: 3600,
    });
    expect(parsed.ringSeconds).toBe(3600);
  });

  it("ringSeconds の0以下を拒否する", () => {
    expect(() =>
      CreateTimerSchema.parse({
        name: "テスト",
        baseSeconds: 300,
        ringSeconds: 0,
      }),
    ).toThrow();
  });

  it("ringSeconds の3600超を拒否する", () => {
    expect(() =>
      CreateTimerSchema.parse({
        name: "テスト",
        baseSeconds: 300,
        ringSeconds: 3601,
      }),
    ).toThrow();
  });

  it("alarm モードで ephemeral と必須項目を併用できる", () => {
    const parsed = CreateTimerSchema.parse({
      name: "アラーム",
      mode: "alarm",
      baseSeconds: 0,
      targetMinutes: 600,
      tzOffsetMinutes: 540,
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
      ringSeconds: 1800,
      baseSeconds: 600,
      adjustMinutes: 5,
      mode: "alarm",
      calorieGoalKcal: 1615,
    });
    expect(parsed.ringSeconds).toBe(1800);
    expect(parsed.baseSeconds).toBe(600);
    expect(parsed.adjustMinutes).toBe(5);
    expect(parsed.mode).toBe("alarm");
    expect(parsed.calorieGoalKcal).toBe(1615);
  });

  it("不正な mode を拒否する", () => {
    expect(() => UserPreferencesSchema.parse({ mode: "stopwatch" })).toThrow();
  });

  it("adjustMinutes の範囲外を拒否する", () => {
    expect(() => UserPreferencesSchema.parse({ adjustMinutes: 0 })).toThrow();
    expect(() =>
      UserPreferencesSchema.parse({ adjustMinutes: 1000 }),
    ).toThrow();
  });

  it("ringSeconds の範囲外を拒否する", () => {
    expect(() => UserPreferencesSchema.parse({ ringSeconds: 0 })).toThrow();
    expect(() => UserPreferencesSchema.parse({ ringSeconds: 3601 })).toThrow();
  });

  it("calorieGoalKcal は正の整数だけを受け入れる", () => {
    expect(UserPreferencesSchema.parse({ calorieGoalKcal: 1616 })).toEqual({
      calorieGoalKcal: 1616,
    });
    for (const value of [1.5, 0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() =>
        UserPreferencesSchema.parse({ calorieGoalKcal: value }),
      ).toThrow();
    }
  });
});

describe("カロリー計算スキーマ", () => {
  it("品目の正の整数kcalを受け入れ、小数と非正数と非有限値を拒否する", () => {
    expect(
      CreateCalorieItemSchema.parse({ name: "食品", kcal: 13, note: "" }),
    ).toEqual({ name: "食品", kcal: 13, note: "" });
    for (const kcal of [12.5, 0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() =>
        CreateCalorieItemSchema.parse({ name: "食品", kcal, note: "" }),
      ).toThrow();
      expect(() =>
        CalorieItemCsvRowSchema.parse({ name: "食品", kcal, note: "" }),
      ).toThrow();
    }
  });

  it("記録の0以上の整数数量を受け入れ、小数と負数と非有限値と上限超過を拒否する", () => {
    expect(
      CreateCalorieRecordSchema.parse({
        consumedAt: "2026/09/01 12:34",
        itemId: 1,
        quantity: 2,
        tzOffsetMinutes: 540,
      }).quantity,
    ).toBe(2);
    expect(
      CreateCalorieRecordSchema.parse({
        consumedAt: "2026/09/01 12:34",
        itemId: 1,
        quantity: 0,
        tzOffsetMinutes: 540,
      }).quantity,
    ).toBe(0);
    expect(
      CalorieRecordCsvRowSchema.parse({
        consumed_at: "2026/09/01 12:34",
        item_name: "食品",
        quantity: 0,
      }).quantity,
    ).toBe(0);
    for (const quantity of [0.5, -1, Number.NaN, 1_000_001]) {
      expect(() =>
        CreateCalorieRecordSchema.parse({
          consumedAt: "2026/09/01 12:34",
          itemId: 1,
          quantity,
          tzOffsetMinutes: 540,
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
      CreateCalorieRecordSchema.parse({
        consumedAt: "2026/09/01 12:34",
        itemId: 1,
        quantity: 1,
        tzOffsetMinutes: 540,
      }).consumedAt,
    ).toBe("2026/09/01 12:34");
    for (const consumedAt of [
      "2026-09-01 12:34",
      "2026/02/30 12:34",
      "2026/09/01 24:00",
      "2026/09/01 12:34:56",
    ]) {
      expect(() =>
        CreateCalorieRecordSchema.parse({
          consumedAt,
          itemId: 1,
          quantity: 1,
          tzOffsetMinutes: 540,
        }),
      ).toThrow();
    }
  });

  it("記録は品目と一時項目名のどちらか一方だけを受け入れ、一時項目名の前後の空白を除く", () => {
    const base = {
      consumedAt: "2026/09/01 12:34",
      quantity: 450,
      tzOffsetMinutes: 540,
    };
    expect(
      CreateCalorieRecordSchema.parse({ ...base, temporaryName: " 外食 " }),
    ).toMatchObject({ temporaryName: "外食" });
    for (const target of [
      {},
      { itemId: 1, temporaryName: "外食" },
      { temporaryName: "  " },
    ]) {
      expect(() =>
        CreateCalorieRecordSchema.parse({ ...base, ...target }),
      ).toThrow();
      expect(() =>
        UpdateCalorieRecordSchema.parse({ ...base, ...target, recordId: 1 }),
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

describe("CreateTaskSchema / UpdateTaskSchema の本文バイト長上限", () => {
  it("CreateTaskSchema は空文字列を拒否する", () => {
    expect(() => CreateTaskSchema.parse({ listId: 1, text: "" })).toThrow(
      "タスク内容は必須です",
    );
  });

  it("CreateTaskSchema は上限バイト数ちょうどのASCII文字列を許容する", () => {
    const text = "a".repeat(MAX_TASK_TEXT_BYTES);
    const parsed = CreateTaskSchema.parse({ listId: 1, text });
    expect(parsed.text).toHaveLength(MAX_TASK_TEXT_BYTES);
  });

  it("CreateTaskSchema は上限バイト数を1バイト超えるASCII文字列を拒否する", () => {
    const text = "a".repeat(MAX_TASK_TEXT_BYTES + 1);
    expect(() => CreateTaskSchema.parse({ listId: 1, text })).toThrow();
  });

  it("CreateTaskSchema はマルチバイト文字でバイト長を判定する", () => {
    // 3バイト文字（日本語）を文字数では上限未満だがバイト長では上限超過になる個数だけ並べる
    const charCount = Math.floor(MAX_TASK_TEXT_BYTES / 3) + 1;
    const text = "あ".repeat(charCount);
    expect(text.length).toBeLessThan(MAX_TASK_TEXT_BYTES);
    expect(() => CreateTaskSchema.parse({ listId: 1, text })).toThrow();
  });

  it("UpdateTaskSchema は上限バイト数ちょうどのASCII文字列を許容する", () => {
    const text = "a".repeat(MAX_TASK_TEXT_BYTES);
    const parsed = UpdateTaskSchema.parse({ listId: 1, taskId: 2, text });
    expect(parsed.text).toHaveLength(MAX_TASK_TEXT_BYTES);
  });

  it("UpdateTaskSchema は上限バイト数を1バイト超えるASCII文字列を拒否する", () => {
    const text = "a".repeat(MAX_TASK_TEXT_BYTES + 1);
    expect(() =>
      UpdateTaskSchema.parse({ listId: 1, taskId: 2, text }),
    ).toThrow();
  });
});

describe("タイマーの秒数上限", () => {
  it("作成と更新で99時間59分59秒を許容し、それを超える値を拒否する", () => {
    expect(
      CreateTimerSchema.parse({ name: "上限", baseSeconds: 359999 })
        .baseSeconds,
    ).toBe(359999);
    expect(
      UpdateTimerSchema.parse({ timerId: 1, baseSeconds: 359999 }).baseSeconds,
    ).toBe(359999);
    expect(() =>
      CreateTimerSchema.parse({ name: "超過", baseSeconds: 360000 }),
    ).toThrow();
    expect(() =>
      UpdateTimerSchema.parse({ timerId: 1, baseSeconds: 360000 }),
    ).toThrow();
  });
});

describe("並べ替え対象の一意性", () => {
  it("同じIDを2回指定する入力を拒否する", () => {
    expect(() => ReorderTimersSchema.parse({ timerIds: [1, 1] })).toThrow();
    expect(() =>
      ReorderTasksSchema.parse({ listId: 1, taskIds: [1, 1] }),
    ).toThrow();
    expect(ReorderTimersSchema.parse({ timerIds: [1, 2] }).timerIds).toEqual([
      1, 2,
    ]);
  });
});
