/**
 * @fileoverview MergeListDialog コンポーネントの smoke test
 *
 * ダイアログのアクセシブル名（aria-labelledby参照先の見出しテキスト）を検証する。
 */
import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import MergeListDialog from "./MergeListDialog.svelte";

describe("MergeListDialog", () => {
  it("open=true のとき aria-labelledby でタイトル「リストの統合」がアクセシブル名として取得できる", () => {
    render(MergeListDialog, {
      props: {
        open: true,
        sourceList: { id: 1, title: "元リスト" },
        allLists: [
          {
            id: 1,
            title: "元リスト",
            sort_order: 0,
            last_updated: "2026-07-19T00:00:00.000Z",
            status: "active",
            todo_count: 0,
          },
          {
            id: 2,
            title: "統合先",
            sort_order: 1,
            last_updated: "2026-07-19T00:00:00.000Z",
            status: "active",
            todo_count: 0,
          },
        ],
        taskCount: 3,
        onSubmit: vi.fn(),
        onClose: vi.fn(),
      },
    });

    expect(
      screen.getByRole("dialog", { name: "リストの統合" }),
    ).toBeInTheDocument();
  });
});
