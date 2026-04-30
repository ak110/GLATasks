/**
 * @fileoverview ConfirmDialog コンポーネントの smoke test
 *
 * 主要な表示パターン（open 状態・title 有無・カスタムラベル）を検証する。
 */
import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog.svelte";

describe("ConfirmDialog", () => {
  it("open=true のときメッセージが表示される", () => {
    render(ConfirmDialog, {
      props: {
        open: true,
        message: "本当に削除しますか？",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    expect(screen.getByText("本当に削除しますか？")).toBeInTheDocument();
  });

  it("open=false のとき何も表示されない", () => {
    render(ConfirmDialog, {
      props: {
        open: false,
        message: "本当に削除しますか？",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    expect(screen.queryByText("本当に削除しますか？")).not.toBeInTheDocument();
  });

  it("title が指定されたとき見出しが表示される", () => {
    render(ConfirmDialog, {
      props: {
        open: true,
        title: "削除の確認",
        message: "この操作は取り消せません。",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    expect(
      screen.getByRole("heading", { name: "削除の確認" }),
    ).toBeInTheDocument();
  });

  it("confirmLabel と cancelLabel が表示される", () => {
    render(ConfirmDialog, {
      props: {
        open: true,
        message: "確認してください。",
        confirmLabel: "はい",
        cancelLabel: "いいえ",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    expect(screen.getByRole("button", { name: "はい" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "いいえ" })).toBeInTheDocument();
  });
});
