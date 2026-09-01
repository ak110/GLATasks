/**
 * @fileoverview カロリー記録日時のブラウザ妥当性検証テスト
 */

import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import CalorieRecordTable from "./CalorieRecordTable.svelte";

describe("CalorieRecordTable", () => {
  it("既定の日時がyyyy/MM/dd HH:mm形式として妥当である", () => {
    render(CalorieRecordTable, {
      items: [],
      records: [],
      windowOffset: 0,
      onWindowChange: vi.fn(),
      onCreate: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    const input = screen.getByLabelText("日時") as HTMLInputElement;
    expect(input).toHaveAttribute(
      "pattern",
      "[0-9]{4}/[0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2}",
    );
    expect(input.validity.patternMismatch).toBe(false);
  });
});
