/**
 * @fileoverview カロリー記録フォームの日時検証・取消操作、行操作メニュー及び品目の検索行のテスト
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

const secondRecord = {
  ...record,
  id: 2,
  item_id: 3,
  item_name: "飲料水",
  item_kcal: 0,
  quantity: 1,
  total_kcal: 0,
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

  it("数量入力欄は0を下限とする", () => {
    renderTable();

    expect(screen.getByLabelText("数量")).toHaveAttribute("min", "0");
  });

  it("数量0の記録を追加できる", async () => {
    const onCreate = vi.fn();
    renderTable({ items: [{ id: 1, name: "食品" }], onCreate });

    await fireEvent.input(screen.getByLabelText("品目"), {
      target: { value: "食品" },
    });
    await fireEvent.input(screen.getByLabelText("数量"), {
      target: { value: "0" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "追加" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ item_id: 1, quantity: 0 }),
    );
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

  it("品目の検索に入力すると部分一致した記録行だけを表示する", async () => {
    renderTable({ records: [record, secondRecord] });

    await fireEvent.input(screen.getByTestId("calorie-record-filter"), {
      target: { value: "飲料" },
    });

    const rows = screen.getAllByTestId("calorie-record-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("飲料水");
  });

  it("クリアボタンで記録の検索条件を消去できる", async () => {
    renderTable({ records: [record, secondRecord] });
    const filter = screen.getByTestId(
      "calorie-record-filter",
    ) as HTMLInputElement;
    await fireEvent.input(filter, { target: { value: "飲料" } });

    await fireEvent.click(screen.getByTestId("calorie-record-filter-clear"));

    expect(screen.getAllByTestId("calorie-record-row")).toHaveLength(2);
    expect(filter.value).toBe("");
  });

  it("検索条件の入力ではonWindowChangeを呼び出さない", async () => {
    const onWindowChange = vi.fn();
    renderTable({ records: [record], onWindowChange });

    await fireEvent.input(screen.getByTestId("calorie-record-filter"), {
      target: { value: "食品" },
    });

    expect(onWindowChange).not.toHaveBeenCalled();
  });

  it("記録の検索は大文字小文字を区別せず空白だけの入力では全行を表示する", async () => {
    renderTable({
      records: [
        { ...record, item_name: "Coke" },
        { ...secondRecord, item_name: "水" },
      ],
    });
    const filter = screen.getByTestId("calorie-record-filter");

    await fireEvent.input(filter, { target: { value: "coke" } });
    expect(screen.getAllByTestId("calorie-record-row")).toHaveLength(1);

    await fireEvent.input(filter, { target: { value: " " } });
    expect(screen.getAllByTestId("calorie-record-row")).toHaveLength(2);
  });

  it("記録が存在し検索結果が0件のときは該当なしの文面を表示する", async () => {
    renderTable({ records: [record] });

    await fireEvent.input(screen.getByTestId("calorie-record-filter"), {
      target: { value: "該当なし" },
    });

    expect(screen.queryAllByTestId("calorie-record-row")).toHaveLength(0);
    expect(screen.getByText("該当する記録はありません")).toBeInTheDocument();
    expect(
      screen.queryByText("この期間の記録はありません"),
    ).not.toBeInTheDocument();
  });

  it("記録が0件のときは既存の空状態の文面を表示する", () => {
    renderTable({ records: [] });

    expect(screen.getByText("この期間の記録はありません")).toBeInTheDocument();
  });
});
