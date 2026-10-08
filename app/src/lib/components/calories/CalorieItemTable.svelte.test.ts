/**
 * @fileoverview カロリー品目一覧の検索・使用件数・編集時の再読込保留のテスト
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import CalorieItemTable from "./CalorieItemTable.svelte";
import {
  checkConnectivity,
  connectivityState,
} from "#lib/client/sse/connection-recovery.svelte.ts";

const items = [
  {
    id: 1,
    name: "食品",
    kcal: 120,
    note: "食事",
    recordCount: 0,
    autoRecordCount: 0,
  },
  {
    id: 2,
    name: "飲料水",
    kcal: 1,
    note: "飲み物",
    recordCount: 0,
    autoRecordCount: 0,
  },
];

function renderTable(overrides: Record<string, unknown> = {}) {
  return render(CalorieItemTable, {
    items: [],
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    filterKeywords: [],
    onClearFilter: vi.fn(),
    ...overrides,
  });
}

describe("CalorieItemTable", () => {
  it("品目の編集ダイアログを開いている間は、入力欄にフォーカスがなくても再読込を保留する", async () => {
    const { unmount } = renderTable({ items: [items[0]] });
    const previousPendingReload = connectivityState.pendingReload;
    connectivityState.pendingReload = false;
    try {
      await fireEvent.click(screen.getByRole("button", { name: "品目の操作" }));
      await fireEvent.click(
        await screen.findByRole("menuitem", { name: "編集" }),
      );
      const dialog = await screen.findByRole("dialog", { name: "品目の編集" });
      await waitFor(() => expect(dialog).toHaveAttribute("open"));
      expect(dialog.tagName).toBe("DIALOG");
      // 共通Dialogの非同期の初期フォーカスを待ってから、入力欄以外へ移す。
      await waitFor(() =>
        expect(within(dialog).getByLabelText("品目名")).toHaveFocus(),
      );
      const submitButton = within(dialog).getByRole("button", {
        name: "変更",
      });
      submitButton.focus();
      expect(submitButton).toHaveFocus();
      expect(document.activeElement?.tagName).toBe("BUTTON");

      // 接続不健全時の公開処理で、ダイアログによるisUserBusyの真分岐を観測する。
      const unhealthyFetch: typeof fetch = vi.fn(
        async () => new Response(null, { status: 503 }),
      );
      await checkConnectivity(unhealthyFetch);
      expect(unhealthyFetch).toHaveBeenCalledOnce();
      expect(connectivityState.pendingReload).toBe(true);
      expect(dialog).toHaveAttribute("open");
    } finally {
      connectivityState.pendingReload = previousPendingReload;
      unmount();
    }
  });

  it("APIの使用件数に基づいて削除を無効にし、理由を表示する", async () => {
    renderTable({
      items: [{ ...items[0], recordCount: 12, autoRecordCount: 2 }],
    });
    await fireEvent.click(screen.getByRole("button", { name: "品目の操作" }));
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", {
          name: "削除 記録12件・自動記録2件で使用中",
        }),
      ).toBeDisabled(),
    );
  });
  it("各検索語を品目名か備考に含む品目だけを表示し、該当が無ければ該当なしの文面を表示する", async () => {
    // 「飲料」は品目名、「み物」は備考だけに含まれる
    const { rerender } = renderTable({
      items,
      filterKeywords: ["飲料", "み物"],
    });

    const rows = screen.getAllByTestId("calorie-item-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("飲料水");

    // 各語は別々の品目にだけ含まれる
    await rerender({ filterKeywords: ["飲料", "食事"] });

    expect(screen.queryAllByTestId("calorie-item-row")).toHaveLength(0);
    expect(screen.getByText("該当する品目はありません")).toBeInTheDocument();
    expect(screen.queryByText("品目がありません")).not.toBeInTheDocument();
  });

  it("品目が0件のときは既存の空状態の文面を表示する", () => {
    renderTable({ items: [] });

    expect(screen.getByText("品目がありません")).toBeInTheDocument();
  });
});
