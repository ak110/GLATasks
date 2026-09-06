/**
 * @fileoverview TaskEditDialog コンポーネントのsmoke test
 *
 * open=true でマウントしてフォーム要素（テキストエリア・タグ欄・リスト選択・ボタン）が
 * 表示されることを確認する。添付ファイルの追加・削除操作でtRPCクライアントの
 * mutateが発火することも確認する。
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi, beforeEach } from "vitest";

import TaskEditDialog from "./TaskEditDialog.svelte";

const { createMutateMock, deleteMutateMock } = vi.hoisted(() => ({
  createMutateMock: vi.fn().mockResolvedValue({ success: true }),
  deleteMutateMock: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("$lib/trpc", () => ({
  trpc: {
    attachments: {
      create: { mutate: createMutateMock },
      delete: { mutate: deleteMutateMock },
    },
  },
}));

/** テスト用のデフォルト props */
function makeDefaultProps() {
  return {
    open: true,
    text: "テストタスクの内容",
    moveTo: "1",
    completed: false,
    tags: [],
    kind: "normal" as const,
    listTagCandidates: [],
    lists: [{ id: 1, title: "テストリスト" }],
    taskId: 42,
    attachments: [],
    onAttachmentChange: vi.fn(),
    onSubmit: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("TaskEditDialog", () => {
  beforeEach(() => {
    createMutateMock.mockClear();
    deleteMutateMock.mockClear();
  });

  it("open=true のときダイアログのヘッダーが表示される", () => {
    render(TaskEditDialog, { props: makeDefaultProps() });
    expect(
      screen.getByRole("heading", { name: "タスクの編集" }),
    ).toBeInTheDocument();
  });

  it("ダイアログ本体の最大幅を4xlとする", () => {
    render(TaskEditDialog, { props: makeDefaultProps() });

    const dialogBody = screen.getByRole("group", {
      name: "タスク編集フォーム（ファイルドロップ対応）",
    });
    expect(dialogBody).toHaveClass("max-w-4xl");
    expect(dialogBody).not.toHaveClass("max-w-2xl");
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

  it("ファイルを選択するとattachments.createのmutateが発火しonAttachmentChangeが呼ばれる", async () => {
    const props = makeDefaultProps();
    render(TaskEditDialog, { props });

    const file = new File(["hello"], "資料.txt", { type: "text/plain" });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(createMutateMock).toHaveBeenCalledWith({
        taskId: 42,
        filename: "資料.txt",
        mimeType: "text/plain",
        data: expect.any(String),
      });
    });
    expect(props.onAttachmentChange).toHaveBeenCalled();
  });

  it("既存添付の削除ボタンでattachments.deleteのmutateが発火しonAttachmentChangeが呼ばれる", async () => {
    const props = {
      ...makeDefaultProps(),
      attachments: [
        {
          id: 7,
          filename: "既存資料.pdf",
          mimeType: "application/pdf",
          size: 100,
          created: "2024-01-01T00:00:00.000Z",
        },
      ],
    };
    render(TaskEditDialog, { props });

    await fireEvent.click(
      screen.getByRole("button", { name: "既存資料.pdfを削除" }),
    );

    await waitFor(() => {
      expect(deleteMutateMock).toHaveBeenCalledWith({ attachmentId: 7 });
    });
    expect(props.onAttachmentChange).toHaveBeenCalled();
  });
});
