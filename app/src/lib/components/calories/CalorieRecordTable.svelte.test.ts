/**
 * @fileoverview カロリー記録フォームの日時検証・取消操作と行操作メニューのテスト
 */

import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import CalorieRecordTable from "./CalorieRecordTable.svelte";

const record = {
  id: 1,
  item_id: 2,
  item_name: "食品",
  item_kcal: 120,
  consumed_at: "2026-08-01T01:00:00.000Z",
  quantity: 2,
  total_kcal: 240,
};

function renderTable(overrides: Record<string, unknown> = {}) {
  return render(CalorieRecordTable, {
    items: [],
    records: [],
    windowOffset: 0,
    onWindowChange: vi.fn(),
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  });
}

describe("CalorieRecordTable", () => {
  it("既定の日時がyyyy/MM/dd HH:mm形式として妥当である", () => {
    renderTable();

    const input = screen.getByLabelText("日時") as HTMLInputElement;
    expect(input).toHaveAttribute(
      "pattern",
      "[0-9]{4}/[0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2}",
    );
    expect(input.validity.patternMismatch).toBe(false);
  });

  it("編集状態でなくても取消で入力欄を初期状態へ復元できる", async () => {
    renderTable();
    const datetime = screen.getByLabelText("日時") as HTMLInputElement;
    const item = screen.getByLabelText("品目") as HTMLInputElement;
    const quantity = screen.getByLabelText("数量") as HTMLInputElement;
    await fireEvent.input(datetime, { target: { value: "2026/08/01 01:00" } });
    await fireEvent.input(item, { target: { value: "食品" } });
    await fireEvent.input(quantity, { target: { value: "3" } });

    await fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(datetime.value).not.toBe("2026/08/01 01:00");
    expect(item.value).toBe("");
    expect(quantity.value).toBe("1");
  });

  it("行の操作メニューからコピーと削除を実行できる", async () => {
    const onDelete = vi.fn();
    renderTable({ records: [record], onDelete });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "記録の操作" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "コピー" }));

    expect((screen.getByLabelText("品目") as HTMLInputElement).value).toBe(
      "食品",
    );
    expect((screen.getByLabelText("数量") as HTMLInputElement).value).toBe("2");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "記録の操作" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "削除" }));

    expect(onDelete).toHaveBeenCalledWith(record);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
