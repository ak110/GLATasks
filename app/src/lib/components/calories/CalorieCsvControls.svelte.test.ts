/**
 * @fileoverview カロリーCSVの解析エラー通知テスト
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import CalorieCsvControls from "./CalorieCsvControls.svelte";

function csvFile(contents: string): File {
  const file = new File([contents], "calories.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", {
    value: () => Promise.resolve(contents),
  });
  return file;
}

function renderControls() {
  const onImportItems = vi.fn();
  const onImportRecords = vi.fn();
  const onExportRecords = vi
    .fn()
    .mockRejectedValue(new Error("取得に失敗しました"));
  render(CalorieCsvControls, {
    items: [],
    onExportRecords,
    onImportItems,
    onImportRecords,
  });
  return { onImportItems, onImportRecords, onExportRecords };
}

describe("CalorieCsvControls", () => {
  it("全記録はCSV出力を選んだときに取得し、取得失敗を表示する", async () => {
    const { onExportRecords } = renderControls();
    expect(onExportRecords).not.toHaveBeenCalled();
    await fireEvent.click(
      screen.getByRole("button", { name: "記録をエクスポート" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "取得に失敗しました",
      ),
    );
    expect(onExportRecords).toHaveBeenCalledOnce();
  });
  it("品目CSVのヘッダー違いを画面内へ通知する", async () => {
    const { onImportItems } = renderControls();

    await fireEvent.change(screen.getByTestId("calorie-items-import"), {
      target: {
        files: [csvFile("名称,kcal,備考\r\n食品,1,\r\n")],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "CSVヘッダーは品目,kcal,備考が必要です",
      );
    });
    expect(onImportItems).not.toHaveBeenCalled();
  });

  it("記録CSVの不正日時を画面内へ通知する", async () => {
    const { onImportRecords } = renderControls();

    await fireEvent.change(screen.getByTestId("calorie-records-import"), {
      target: {
        files: [csvFile("日時,品目,数量\r\n2026/02/30 12:00,食品,1\r\n")],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "記録CSVの2行目が不正です",
      );
    });
    expect(onImportRecords).not.toHaveBeenCalled();
  });
});
