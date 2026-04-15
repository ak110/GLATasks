/**
 * @fileoverview Zod スキーマのテスト
 */

import { describe, it, expect } from "vitest";
import {
  CreateTaskSchema,
  CreateTimerSchema,
  TagInfoSchema,
  UpdateTaskSchema,
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
