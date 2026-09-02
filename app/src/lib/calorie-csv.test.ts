/**
 * @fileoverview 簡易カロリー計算CSVの契約テスト
 */

import Papa from "papaparse";
import { describe, expect, it } from "vitest";

import {
  exportCalorieItemsCsv,
  exportCalorieRecordsCsv,
  parseCalorieItemsCsv,
  parseCalorieRecordsCsv,
} from "./calorie-csv";

const PRESERVED_VALUES = [
  "通常値",
  "=1+1",
  "+食品",
  "-500",
  "@name",
  "\t値",
  "\r値",
  "'",
  "''",
  "'=値",
];

describe("品目CSV", () => {
  it("BOMとCRLFを付け、引用符を含む値も往復する", () => {
    const csv = exportCalorieItemsCsv([
      { name: "食品,一", kcal: 13, note: '改行\nと"引用符"' },
      { name: "=食品", kcal: 3, note: "'+備考" },
    ]);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(parseCalorieItemsCsv(csv)).toEqual([
      { name: "食品,一", kcal: 13, note: '改行\nと"引用符"' },
      { name: "=食品", kcal: 3, note: "'+備考" },
    ]);
  });

  it("品目名と備考を独自変換せずに出力し、そのまま再インポートする", () => {
    const rows = PRESERVED_VALUES.map((value, index) => ({
      name: value,
      kcal: index + 1,
      note: value,
    }));
    const csv = exportCalorieItemsCsv(rows);
    const rawRows = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ""), {
      skipEmptyLines: "greedy",
    });

    expect(rawRows.errors).toEqual([]);
    expect(
      rawRows.data.slice(1).map(([name, , note]) => ({ name, note })),
    ).toEqual(rows.map(({ name, note }) => ({ name, note })));
    expect(parseCalorieItemsCsv(csv)).toEqual(rows);
  });

  it("小数のkcalを拒否する", () => {
    expect(() =>
      parseCalorieItemsCsv("品目,kcal,備考\r\n食品,12.5,\r\n"),
    ).toThrow("2行目");
  });

  it("固定ヘッダー違いと重複品目を拒否する", () => {
    expect(() => parseCalorieItemsCsv("名称,kcal,備考\r\n食品,1,\r\n")).toThrow(
      "CSVヘッダー",
    );
    expect(() =>
      parseCalorieItemsCsv("品目,kcal,備考\r\n食品,1,\r\n食品,2,\r\n"),
    ).toThrow("重複");
  });

  it("10,000行を受け入れ、10,001行を拒否する", () => {
    const rows = Array.from(
      { length: 10_001 },
      (_, index) => `食品${index},1,`,
    );
    const header = "品目,kcal,備考\r\n";

    expect(
      parseCalorieItemsCsv(`${header}${rows.slice(0, 10_000).join("\r\n")}`),
    ).toHaveLength(10_000);
    expect(() => parseCalorieItemsCsv(`${header}${rows.join("\r\n")}`)).toThrow(
      "10000行以下",
    );
  });
});

describe("記録CSV", () => {
  it("固定ヘッダーで日時・品目・数量を往復する", () => {
    const csv = exportCalorieRecordsCsv([
      {
        consumed_at: "2026/09/01 12:34",
        item_name: "+食品",
        quantity: 2,
      },
    ]);
    expect(parseCalorieRecordsCsv(csv)).toEqual([
      {
        consumed_at: "2026/09/01 12:34",
        item_name: "+食品",
        quantity: 2,
      },
    ]);
  });

  it("品目名を独自変換せずに出力し、そのまま再インポートする", () => {
    const rows = PRESERVED_VALUES.map((itemName, index) => ({
      consumed_at: `2026/09/01 12:${String(index).padStart(2, "0")}`,
      item_name: itemName,
      quantity: index + 1,
    }));
    const csv = exportCalorieRecordsCsv(rows);
    const rawRows = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ""), {
      skipEmptyLines: "greedy",
    });

    expect(rawRows.errors).toEqual([]);
    expect(rawRows.data.slice(1).map(([, itemName]) => itemName)).toEqual(
      rows.map(({ item_name }) => item_name),
    );
    expect(parseCalorieRecordsCsv(csv)).toEqual(rows);
  });

  it("不正日時と非正数と小数を拒否する", () => {
    expect(() =>
      parseCalorieRecordsCsv("日時,品目,数量\r\n2026/02/30 12:00,食品,1\r\n"),
    ).toThrow("2行目");
    expect(() =>
      parseCalorieRecordsCsv("日時,品目,数量\r\n2026/02/28 12:00,食品,0\r\n"),
    ).toThrow("2行目");
    expect(() =>
      parseCalorieRecordsCsv("日時,品目,数量\r\n2026/02/28 12:00,食品,1.5\r\n"),
    ).toThrow("2行目");
  });
});
