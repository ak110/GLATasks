/**
 * @fileoverview Zod スキーマのテスト
 */

import { describe, it, expect } from "vitest";
import {
  CreateTaskSchema,
  CreateTimerSchema,
  TagInfoSchema,
  UpdateTaskSchema,
  UserPreferencesSchema,
} from "./schemas";

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

  it("keep_ringing は未指定だと false になる", () => {
    const parsed = CreateTimerSchema.parse({
      name: "テスト",
      base_seconds: 300,
    });
    expect(parsed.keep_ringing).toBe(false);
  });

  it("keep_ringing を true にできる", () => {
    const parsed = CreateTimerSchema.parse({
      name: "テスト",
      base_seconds: 300,
      keep_ringing: true,
    });
    expect(parsed.keep_ringing).toBe(true);
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
      keep_ringing: true,
      base_seconds: 600,
      adjust_minutes: 5,
      mode: "alarm",
    });
    expect(parsed.keep_ringing).toBe(true);
    expect(parsed.base_seconds).toBe(600);
    expect(parsed.adjust_minutes).toBe(5);
    expect(parsed.mode).toBe("alarm");
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
