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

vi.mock("#lib/client/trpc.ts", () => ({
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
    sessionId: 1,
    attachments: [],
    onAttachmentChange: vi.fn(),
    onSubmit: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("TaskEditDialog", () => {
  beforeEach(() => {
    createMutateMock.mockReset().mockResolvedValue({ success: true });
    deleteMutateMock.mockReset().mockResolvedValue({ success: true });
  });

  it("複数添付の途中で対象が切り替わっても全ファイルを開始時のタスクへ送る", async () => {
    const props = makeDefaultProps();
    const upload = Promise.withResolvers<{ success: boolean }>();
    createMutateMock.mockReturnValueOnce(upload.promise);
    const view = render(TaskEditDialog, { props });
    const files = [new File(["a"], "a.txt"), new File(["b"], "b.txt")];
    await fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files },
    });
    await waitFor(() => expect(createMutateMock).toHaveBeenCalledTimes(1));
    await view.rerender({
      ...props,
      taskId: 99,
      sessionId: 2,
      text: "別タスク",
    });
    upload.resolve({ success: true });
    await waitFor(() => expect(createMutateMock).toHaveBeenCalledTimes(2));
    expect(createMutateMock.mock.calls.map((call) => call[0].taskId)).toEqual([
      42, 42,
    ]);
    expect(screen.getByRole("textbox", { name: "内容" })).toHaveValue(
      "別タスク",
    );
    expect(props.onAttachmentChange).not.toHaveBeenCalled();
  });

  it("保存待機中の再送を防ぎ、新入力を成功応答で閉じない", async () => {
    const props = makeDefaultProps();
    const save = Promise.withResolvers<boolean>();
    props.onSubmit.mockReturnValue(save.promise);
    render(TaskEditDialog, { props });
    const button = screen.getByRole("button", { name: "保存して閉じる" });
    await fireEvent.click(button);
    await fireEvent.click(button);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    await fireEvent.input(screen.getByRole("textbox", { name: "内容" }), {
      target: { value: "保存後の新入力" },
    });
    save.resolve(true);
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "内容" })).toHaveValue(
      "保存後の新入力",
    );
  });

  it("保存中に同じタスクを別セッションで開くと入力を初期化し古い成功で閉じない", async () => {
    const props = makeDefaultProps();
    const save = Promise.withResolvers<boolean>();
    props.onSubmit.mockReturnValue(save.promise);
    const view = render(TaskEditDialog, { props });
    await fireEvent.click(
      screen.getByRole("button", { name: "保存して閉じる" }),
    );
    await view.rerender({ ...props, sessionId: 2, text: "新セッション" });
    save.resolve(true);
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "内容" })).toHaveValue(
        "新セッション",
      ),
    );
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "同じ入力の保存結果%sに応じて閉じる",
    async (success) => {
      const props = makeDefaultProps();
      props.onSubmit.mockResolvedValue(success);
      render(TaskEditDialog, { props });
      const button = screen.getByRole("button", { name: "保存して閉じる" });
      await fireEvent.click(button);
      await waitFor(() => expect(button).not.toBeDisabled());
      expect(props.onClose).toHaveBeenCalledTimes(success ? 1 : 0);
    },
  );

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
    expect(dialogBody.closest("dialog")).toHaveClass("max-w-4xl");
    expect(dialogBody.closest("dialog")).not.toHaveClass("max-w-2xl");
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

  it("編集中のcancelは破棄確認を開き、確認のcancelでは編集を保つ", async () => {
    const props = makeDefaultProps();
    render(TaskEditDialog, { props });
    await fireEvent.input(screen.getByRole("textbox", { name: "内容" }), {
      target: { value: "変更後" },
    });
    const editor = screen.getByRole("dialog", { name: "タスクの編集" });
    await fireEvent(
      editor,
      new Event("cancel", { cancelable: true, bubbles: true }),
    );
    const confirmation = await screen.findByRole("dialog", {
      name: "変更を破棄",
    });
    expect(editor).toHaveAttribute("open");
    expect(confirmation).toHaveAttribute("open");
    await fireEvent(
      confirmation,
      new Event("cancel", { cancelable: true, bubbles: true }),
    );
    expect(
      screen.queryByRole("dialog", { name: "変更を破棄" }),
    ).not.toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "内容" })).toHaveValue("変更後");
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
