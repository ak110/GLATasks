/**
 * @fileoverview PromptDialog コンポーネントのsmoke test
 *
 * open=true でマウントして入力欄・ボタンが表示されることを確認する。
 */

import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import PromptDialog from "./PromptDialog.svelte";

describe("PromptDialog", () => {
  it("open=true のとき入力欄が表示される", () => {
    render(PromptDialog, {
      props: {
        open: true,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("open=false のとき何も表示されない", () => {
    render(PromptDialog, {
      props: {
        open: false,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("title が指定されたとき見出しが表示される", () => {
    render(PromptDialog, {
      props: {
        open: true,
        title: "リスト名を入力",
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    expect(
      screen.getByRole("heading", { name: "リスト名を入力" }),
    ).toBeInTheDocument();
  });

  it("message が指定されたとき説明文が表示される", () => {
    render(PromptDialog, {
      props: {
        open: true,
        message: "新しいリスト名を入力してください。",
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    expect(
      screen.getByText("新しいリスト名を入力してください。"),
    ).toBeInTheDocument();
  });

  it("submitLabel と cancelLabel が表示される", () => {
    render(PromptDialog, {
      props: {
        open: true,
        submitLabel: "作成",
        cancelLabel: "やめる",
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    expect(screen.getByRole("button", { name: "作成" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "やめる" })).toBeInTheDocument();
  });
});
