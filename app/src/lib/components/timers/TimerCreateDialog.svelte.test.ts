/**
 * @fileoverview TimerCreateDialog コンポーネントの smoke test
 *
 * ダイアログのアクセシブル名（aria-labelledby参照先の見出しテキスト）を検証する。
 */
import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import TimerCreateDialog from "./TimerCreateDialog.svelte";

describe("TimerCreateDialog", () => {
  it("mode=create のとき aria-labelledby でタイトル「タイマー追加」がアクセシブル名として取得できる", () => {
    render(TimerCreateDialog, {
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
