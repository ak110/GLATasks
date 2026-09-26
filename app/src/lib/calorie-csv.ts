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
const RECORD_HEADERS = ["日時", "品目", "数量", "一時項目"] as const;
/** 一時項目の列を持たない旧形式。全行を品目の記録として取り込む */
const LEGACY_RECORD_HEADERS = ["日時", "品目", "数量"] as const;

export type CalorieItemCsvExportRow = {
  name: string;
  kcal: number;
  note: string;
};

export type CalorieRecordCsvExportRow = {
  consumed_at: string;
  item_name: string;
  quantity: number;
  temporary: boolean;
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
    ...rows.map((row) => [
      row.consumed_at,
      row.item_name,
      row.quantity,
      row.temporary ? "1" : "",
    ]),
  ]);
}

function parseRows(
  csv: string,
  ...acceptedHeaders: ReadonlyArray<readonly string[]>
): string[][] {
  const result = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
  });
  if (result.errors.length > 0) {
    throw new Error(`CSVを解析できません: ${result.errors[0].message}`);
  }
  if (result.data.length === 0) throw new Error("CSVが空です");
  const [headers, ...rows] = result.data;
  const expectedHeaders = acceptedHeaders.find(
    (candidate) =>
      headers.length === candidate.length &&
      headers.every((header, index) => header === candidate[index]),
  );
  if (!expectedHeaders) {
    throw new Error(`CSVヘッダーは${acceptedHeaders[0].join(",")}が必要です`);
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
  return parseRows(csv, RECORD_HEADERS, LEGACY_RECORD_HEADERS).map(
    ([consumedAt, itemName, quantity, temporary = ""], index) => {
      const result = CalorieRecordCsvRowSchema.safeParse({
        consumed_at: consumedAt,
        item_name: itemName,
        quantity: Number(quantity),
        temporary: temporary === "1",
      });
      if (!result.success || (temporary !== "" && temporary !== "1")) {
        throw new Error(`記録CSVの${index + 2}行目が不正です`);
      }
      return result.data;
    },
  );
}
