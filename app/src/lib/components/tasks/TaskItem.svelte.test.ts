/**
 * @fileoverview TaskItem コンポーネントのsmoke test
 *
 * マウントできて主要要素（チェックボックス・タイトル・タグ・編集ボタン）が
 * 表示されることを確認する。
 */

import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import TaskItem from "./TaskItem.svelte";

/** テスト用タスクデータのデフォルト値 */
function makeTask(overrides?: object) {
  return {
    id: 1,
    title: "テストタスク",
    notes: "",
    status: "active",
    tags: [],
    ...overrides,
  };
}

describe("TaskItem", () => {
  it("タスクのタイトルとチェックボックスが表示される", () => {
    render(TaskItem, {
      props: {
        task: makeTask({ title: "買い物リストを作る" }),
        onToggle: vi.fn(),
        onEdit: vi.fn(),
      },
    });

    expect(screen.getByRole("checkbox")).toBeInTheDocument();
    expect(screen.getByText("買い物リストを作る")).toBeInTheDocument();
  });

  it("タグが指定されているときタグバッジが表示される", () => {
    render(TaskItem, {
      props: {
        task: makeTask({
          tags: [{ name: "重要", color: "red" }],
        }),
        onToggle: vi.fn(),
        onEdit: vi.fn(),
      },
    });

    expect(screen.getByText("重要")).toBeInTheDocument();
  });

  it("completed 状態のタスクはチェックボックスが checked になる", () => {
    render(TaskItem, {
      props: {
        task: makeTask({ status: "completed" }),
        onToggle: vi.fn(),
        onEdit: vi.fn(),
      },
    });

    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("編集ボタンが表示される", () => {
    render(TaskItem, {
      props: {
        task: makeTask(),
        onToggle: vi.fn(),
        onEdit: vi.fn(),
      },
    });

    expect(
      screen.getByRole("button", { name: "タスクを編集" }),
    ).toBeInTheDocument();
  });

  it("title と notes が両方空のとき（空のタスク）が表示される", () => {
    render(TaskItem, {
      props: {
        task: makeTask({ title: "", notes: "" }),
        onToggle: vi.fn(),
        onEdit: vi.fn(),
      },
    });

    expect(screen.getByText("（空のタスク）")).toBeInTheDocument();
  });
});
