import { createRawSnippet } from "svelte";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import Dialog from "./Dialog.svelte";

describe("共通ダイアログ", () => {
  it("モーダルを開き、閉じるボタンより入力欄へ初期フォーカスを置く", async () => {
    render(Dialog, {
      title: "編集",
      onClose: vi.fn(),
      children: createRawSnippet(() => ({
        render: () => '<input aria-label="内容" />',
      })),
    });
    expect(screen.getByRole("dialog", { name: "編集" })).toHaveAttribute(
      "open",
    );
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "内容" })).toHaveFocus(),
    );
  });
  it("cancelイベントはブラウザによる閉鎖を止め、呼出側の閉じる処理へ渡す", async () => {
    const onClose = vi.fn();
    render(Dialog, {
      title: "確認",
      onClose,
      children: createRawSnippet(() => ({ render: () => "<p>本文</p>" })),
    });
    const dialog = screen.getByRole("dialog", { name: "確認" });
    const event = new Event("cancel", { cancelable: true, bubbles: true });
    await fireEvent(dialog, event);
    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(dialog).toHaveAttribute("open");
  });
});
