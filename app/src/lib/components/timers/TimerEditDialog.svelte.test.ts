/**
 * @fileoverview TimerEditDialog コンポーネントの smoke test
 *
 * ダイアログのアクセシブル名（aria-labelledby参照先の見出しテキスト）を検証する。
 */
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import TimerEditDialog from "#lib/components/timers/TimerEditDialog.svelte";

describe("TimerEditDialog", () => {
  it("送信中はボタンとフォームの再送信を抑止する", async () => {
    const onSubmit = vi.fn();
    render(TimerEditDialog, {
      props: {
        open: true,
        mode: "edit",
        ephemeral: false,
        name: "作業",
        timerMode: "countdown",
        baseSeconds: 300,
        targetMinutes: null,
        adjustMinutes: 1,
        ringSeconds: 3,
        submitting: true,
        onSubmit,
        onClose: vi.fn(),
      },
    });
    const submit = screen.getByTestId("timer-submit-btn");
    expect(submit).toBeDisabled();
    await fireEvent.submit(submit.closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("入力変更を送信と同じsnapshotの形式で通知する", async () => {
    const onInputChange = vi.fn();
    const onSubmit = vi.fn();
    render(TimerEditDialog, {
      props: {
        open: true,
        mode: "edit",
        ephemeral: false,
        name: "作業",
        timerMode: "countdown",
        baseSeconds: 300,
        targetMinutes: null,
        adjustMinutes: 1,
        ringSeconds: 3,
        onInputChange,
        onSubmit,
        onClose: vi.fn(),
      },
    });
    await fireEvent.input(screen.getByTestId("timer-name-input"), {
      target: { value: "変更した入力" },
    });
    await fireEvent.submit(
      screen.getByTestId("timer-submit-btn").closest("form")!,
    );
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "変更した入力" }),
    );
    expect(onInputChange).toHaveBeenLastCalledWith(onSubmit.mock.calls[0][0]);
  });

  it("mode=create のとき aria-labelledby でタイトル「タイマー追加」がアクセシブル名として取得できる", () => {
    render(TimerEditDialog, {
      props: {
        open: true,
        mode: "create" as const,
        ephemeral: false,
        name: "",
        timerMode: "countdown" as const,
        baseSeconds: 300,
        targetMinutes: null,
        adjustMinutes: 0,
        ringSeconds: 3,
        onSubmit: vi.fn(),
        onClose: vi.fn(),
      },
    });

    expect(
      screen.getByRole("dialog", { name: "タイマー追加" }),
    ).toBeInTheDocument();
  });
});
