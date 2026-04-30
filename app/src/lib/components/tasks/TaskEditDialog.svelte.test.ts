/**
 * @fileoverview TaskEditDialog コンポーネントのsmoke test
 *
 * open=true でマウントしてフォーム要素（テキストエリア・タグ欄・リスト選択・ボタン）が
 * 表示されることを確認する。
 */

import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import TaskEditDialog from "./TaskEditDialog.svelte";

/** テスト用のデフォルト props */
function makeDefaultProps() {
  return {
    open: true,
    text: "テストタスクの内容",
    moveTo: "1",
    completed: false,
    tags: [],
    listTagCandidates: [],
    lists: [{ id: 1, title: "テストリスト" }],
    onSubmit: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("TaskEditDialog", () => {
  it("open=true のときダイアログのヘッダーが表示される", () => {
    render(TaskEditDialog, { props: makeDefaultProps() });
    expect(
      screen.getByRole("heading", { name: "タスクの編集" }),
    ).toBeInTheDocument();
  });

  it("open=true のときテキストエリアが表示される", () => {
    render(TaskEditDialog, { props: makeDefaultProps() });
    expect(screen.getByRole("textbox", { name: "内容" })).toBeInTheDocument();
  });

  it("open=true のとき完了チェックボックスが表示される", () => {
    render(TaskEditDialog, { props: makeDefaultProps() });
    expect(screen.getByRole("checkbox", { name: "完了" })).toBeInTheDocument();
  });

  it("open=false のときダイアログが表示されない", () => {
    render(TaskEditDialog, {
      props: { ...makeDefaultProps(), open: false },
    });
    expect(
      screen.queryByRole("heading", { name: "タスクの編集" }),
    ).not.toBeInTheDocument();
  });

  it("open=true のとき保存ボタンが表示される", () => {
    render(TaskEditDialog, { props: makeDefaultProps() });
    expect(
      screen.getByRole("button", { name: "保存して閉じる" }),
    ).toBeInTheDocument();
  });
});
