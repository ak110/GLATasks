/**
 * @fileoverview カロリー計算のCSV入出力
 */

import Papa from "papaparse";

import {
  CalorieItemCsvRowSchema,
  CalorieRecordCsvRowSchema,
  MAX_CALORIE_CSV_ROWS,
  type CalorieItemCsvRow,
  type CalorieRecordCsvRow,
} from "$lib/schemas";

const ITEM_HEADERS = ["品目", "kcal", "備考"] as const;
const RECORD_HEADERS = ["日時", "品目", "数量"] as const;

export type CalorieItemCsvExportRow = {
  name: string;
  kcal: number;
  note: string;
};

export type CalorieRecordCsvExportRow = {
  consumed_at: string;
  item_name: string;
  quantity: number;
};

function serialize(rows: Array<Array<string | number>>): string {
  return `\uFEFF${Papa.unparse(rows, { newline: "\r\n" })}`;
}

export function exportCalorieItemsCsv(
  rows: readonly CalorieItemCsvExportRow[],
): string {
  return serialize([
    [...ITEM_HEADERS],
    ...rows.map((row) => [row.name, row.kcal, row.note]),
  ]);
}

export function exportCalorieRecordsCsv(
  rows: readonly CalorieRecordCsvExportRow[],
): string {
  return serialize([
    [...RECORD_HEADERS],
    ...rows.map((row) => [row.consumed_at, row.item_name, row.quantity]),
  ]);
}

function parseRows(
  csv: string,
  expectedHeaders: readonly string[],
): string[][] {
  const result = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
  });
  if (result.errors.length > 0) {
    throw new Error(`CSVを解析できません: ${result.errors[0].message}`);
  }
  if (result.data.length === 0) throw new Error("CSVが空です");
  const [headers, ...rows] = result.data;
  if (
    headers.length !== expectedHeaders.length ||
    headers.some((header, index) => header !== expectedHeaders[index])
  ) {
    throw new Error(`CSVヘッダーは${expectedHeaders.join(",")}が必要です`);
  }
  if (rows.length > MAX_CALORIE_CSV_ROWS) {
    throw new Error(`CSVは${MAX_CALORIE_CSV_ROWS}行以下にしてください`);
  }
  if (rows.some((row) => row.length !== expectedHeaders.length)) {
    throw new Error("CSVの列数がヘッダーと一致しません");
  }
  return rows;
}

export function parseCalorieItemsCsv(csv: string): CalorieItemCsvRow[] {
  const rows = parseRows(csv, ITEM_HEADERS);
  const parsed = rows.map(([name, kcal, note], index) => {
    const result = CalorieItemCsvRowSchema.safeParse({
      name,
      kcal: Number(kcal),
      note,
    });
    if (!result.success) {
      throw new Error(`品目CSVの${index + 2}行目が不正です`);
    }
    return result.data;
  });
  if (new Set(parsed.map((row) => row.name)).size !== parsed.length) {
    throw new Error("品目CSVに重複した品目名があります");
  }
  return parsed;
}

export function parseCalorieRecordsCsv(csv: string): CalorieRecordCsvRow[] {
  return parseRows(csv, RECORD_HEADERS).map(
    ([consumedAt, itemName, quantity], index) => {
      const result = CalorieRecordCsvRowSchema.safeParse({
        consumed_at: consumedAt,
        item_name: itemName,
        quantity: Number(quantity),
      });
      if (!result.success) {
        throw new Error(`記録CSVの${index + 2}行目が不正です`);
      }
      return result.data;
    },
  );
}
