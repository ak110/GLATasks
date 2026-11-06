/**
 * @fileoverview カロリーCSVの解析エラー通知テスト
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import CalorieCsvControls from "./CalorieCsvControls.svelte";

function csvFile(contents: string): File {
  const file = new File([contents], "calories.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", {
    value: () => Promise.resolve(contents),
    configurable: true,
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
  it("exportの二重起動を独立して拒否する", async () => {
    const request = Promise.withResolvers<never>();
    const onExportRecords = vi.fn(() => request.promise);
    render(CalorieCsvControls, {
      items: [],
      onExportRecords,
      onImportItems: vi.fn(),
      onImportRecords: vi.fn(),
    });
    const button = screen.getByRole("button", { name: "記録をエクスポート" });
    await fireEvent.click(button);
    await fireEvent.click(button);
    expect(onExportRecords).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    request.reject("取得失敗");
    await waitFor(() =>
      expect(screen.getByText(/取得失敗.*再取得/)).toBeInTheDocument(),
    );
  });

  it.each([new Error("通信失敗"), "業務エラー"])(
    "送信済みimport失敗で原因と反映確認を案内する: %s",
    async (failure) => {
      render(CalorieCsvControls, {
        items: [],
        onExportRecords: vi.fn(),
        onImportItems: vi.fn(),
        onImportRecords: vi.fn().mockRejectedValue(failure),
      });
      await fireEvent.change(screen.getByTestId("calorie-records-import"), {
        target: {
          files: [csvFile("日時,品目,数量\r\n2026/08/01 12:00,食品,1\r\n")],
        },
      });
      await fireEvent.click(
        await screen.findByRole("button", { name: "取り込む" }),
      );
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(
          failure instanceof Error ? failure.message : failure,
        );
        expect(screen.getByRole("status")).toHaveTextContent(
          "一覧を確認してから、再操作",
        );
      });
    },
  );
  it.each(["reading", "confirm", "sending"] as const)(
    "export失敗がimportの%sと先行完了を解除しない",
    async (phase) => {
      const read = Promise.withResolvers<string>();
      const save = Promise.withResolvers<{ added: number }>();
      const onImportRecords = vi.fn(() => save.promise);
      render(CalorieCsvControls, {
        items: [],
        onImportItems: vi.fn(),
        onImportRecords,
        onExportRecords: vi.fn().mockRejectedValue(new Error("取得通信失敗")),
      });
      const file = csvFile("");
      Object.defineProperty(file, "text", {
        value: () => read.promise,
        configurable: true,
      });
      await fireEvent.change(screen.getByTestId("calorie-records-import"), {
        target: { files: [file] },
      });
      const confirm = () =>
        within(
          screen.getByRole("dialog", { name: "記録CSVのインポート" }),
        ).getByRole("button", { name: "取り込む" });
      if (phase !== "reading") {
        read.resolve("日時,品目,数量\r\n2026/08/01 12:00,食品,1\r\n");
        await screen.findByRole("dialog", { name: "記録CSVのインポート" });
      }
      if (phase === "sending") await fireEvent.click(confirm());
      await fireEvent.click(
        screen.getByRole("button", { name: "記録をエクスポート" }),
      );
      await waitFor(() =>
        expect(screen.getByText(/取得通信失敗/)).toBeInTheDocument(),
      );
      if (phase === "reading") {
        read.resolve("日時,品目,数量\r\n2026/08/01 12:00,食品,1\r\n");
        await screen.findByRole("dialog", { name: "記録CSVのインポート" });
      }
      if (phase !== "sending") await fireEvent.click(confirm());
      expect(screen.getByTestId("calorie-records-import")).toBeDisabled();
      await fireEvent.change(screen.getByTestId("calorie-records-import"), {
        target: {
          files: [csvFile("日時,品目,数量\r\n2026/08/01 12:00,食品,1\r\n")],
        },
      });
      expect(onImportRecords).toHaveBeenCalledOnce();
      save.resolve({ added: 1 });
      await waitFor(() =>
        expect(screen.getByText("記録を1件追加しました。")).toBeInTheDocument(),
      );
    },
  );
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
      expect(screen.getByRole("status")).toHaveTextContent(
        "CSVファイルを確認し、選び直し",
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
