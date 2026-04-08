/**
 * @fileoverview Zod スキーマのテスト
 */

import { describe, it, expect } from "vitest";
import { CreateTimerSchema } from "./schemas";

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
