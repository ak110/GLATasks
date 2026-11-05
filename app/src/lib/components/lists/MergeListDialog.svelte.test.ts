/**
 * @fileoverview MergeListDialog コンポーネントの smoke test
 *
 * ダイアログのアクセシブル名（aria-labelledby参照先の見出しテキスト）を検証する。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import MergeListDialog from "./MergeListDialog.svelte";

describe("MergeListDialog", () => {
  it("候補の再取得で選択と送信snapshotを変更しない", async () => {
    const allLists = [1, 2, 3].map((id) => ({
      id,
      title: `リスト${id}`,
      sortOrder: id,
      lastUpdated: "2026-07-19T00:00:00.000Z",
      status: "active" as const,
      todoCount: 0,
    }));
    const onSubmit = vi.fn();
    const view = render(MergeListDialog, {
      session: {},
      open: true,
      sourceList: { id: 1, title: "元リスト" },
      allLists,
      taskCount: 3,
      onSubmit,
      onClose: vi.fn(),
    });
    const select = screen.getByLabelText("統合先リスト");
    await waitFor(() => expect(select).toHaveValue("2"));
    await fireEvent.click(screen.getByRole("button", { name: /^統合$/ }));
    expect(onSubmit).toHaveBeenCalledWith(2, expect.any(Function));
    await view.rerender({
      allLists: [...allLists]
        .reverse()
        .map((list) => ({ ...list, todoCount: 1 })),
    });
    expect(onSubmit.mock.calls[0][1]()).toBe(true);
    await waitFor(() => expect(select).toHaveValue("2"));
    await view.rerender({ session: {} });
    await waitFor(() => expect(select).toHaveValue("3"));
    expect(onSubmit.mock.calls[0][1]()).toBe(false);
    await view.rerender({ sourceList: { id: 3, title: "別の元リスト" } });
    await waitFor(() => expect(select).toHaveValue("2"));
  });
  it("open=true のとき aria-labelledby でタイトル「リストの統合」がアクセシブル名として取得できる", () => {
    render(MergeListDialog, {
      props: {
        session: {},
        open: true,
        sourceList: { id: 1, title: "元リスト" },
        allLists: [
          {
            id: 1,
            title: "元リスト",
            sortOrder: 0,
            lastUpdated: "2026-07-19T00:00:00.000Z",
            status: "active",
            todoCount: 0,
          },
          {
            id: 2,
            title: "統合先",
            sortOrder: 1,
            lastUpdated: "2026-07-19T00:00:00.000Z",
            status: "active",
            todoCount: 0,
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
