/**
 * @fileoverview カロリー品目一覧の検索行と表示行のテスト
 */

import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import CalorieItemTable from "./CalorieItemTable.svelte";

const items = [
  { id: 1, name: "食品", kcal: 120, note: "食事" },
  { id: 2, name: "飲料水", kcal: 1, note: "飲み物" },
];

function renderTable(overrides: Record<string, unknown> = {}) {
  return render(CalorieItemTable, {
    items: [],
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    ...overrides,
  });
}

describe("CalorieItemTable", () => {
  it("品目の検索に入力すると部分一致した品目行だけを表示する", async () => {
    renderTable({ items });

    await fireEvent.input(screen.getByTestId("calorie-item-filter"), {
      target: { value: "飲料" },
    });

    const rows = screen.getAllByTestId("calorie-item-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("飲料水");
  });

  it("品目の検索は備考の部分一致でも行を表示する", async () => {
    renderTable({ items });

    await fireEvent.input(screen.getByTestId("calorie-item-filter"), {
      target: { value: "み物" },
    });

    const rows = screen.getAllByTestId("calorie-item-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("飲料水");
  });

  it("品目の検索入力欄へ検索対象を示す文言を表示する", () => {
    renderTable({ items });

    expect(screen.getByTestId("calorie-item-filter")).toHaveAttribute(
      "placeholder",
      "品目名と備考で検索",
    );
    expect(screen.getByTestId("calorie-item-filter")).toHaveAttribute(
      "aria-label",
      "品目名と備考で品目を検索",
    );
  });

  it("クリアボタンで品目の検索条件を消去できる", async () => {
    renderTable({ items });
    const filter = screen.getByTestId(
      "calorie-item-filter",
    ) as HTMLInputElement;
    await fireEvent.input(filter, { target: { value: "飲料" } });

    await fireEvent.click(screen.getByTestId("calorie-item-filter-clear"));

    expect(screen.getAllByTestId("calorie-item-row")).toHaveLength(2);
    expect(filter.value).toBe("");
  });

  it("品目の検索は大文字小文字を区別せず空白だけの入力では全行を表示する", async () => {
    renderTable({
      items: [
        { id: 1, name: "Coke", kcal: 120, note: "" },
        { id: 2, name: "水", kcal: 1, note: "" },
      ],
    });
    const filter = screen.getByTestId("calorie-item-filter");

    await fireEvent.input(filter, { target: { value: "coke" } });
    expect(screen.getAllByTestId("calorie-item-row")).toHaveLength(1);

    await fireEvent.input(filter, { target: { value: " " } });
    expect(screen.getAllByTestId("calorie-item-row")).toHaveLength(2);
  });

  it("品目が存在し検索結果が0件のときは該当なしの文面を表示する", async () => {
    renderTable({ items });

    await fireEvent.input(screen.getByTestId("calorie-item-filter"), {
      target: { value: "該当なし" },
    });

    expect(screen.queryAllByTestId("calorie-item-row")).toHaveLength(0);
    expect(screen.getByText("該当する品目はありません")).toBeInTheDocument();
    expect(screen.queryByText("品目がありません")).not.toBeInTheDocument();
  });

  it("品目が0件のときは既存の空状態の文面を表示する", () => {
    renderTable({ items: [] });

    expect(screen.getByText("品目がありません")).toBeInTheDocument();
  });
});
