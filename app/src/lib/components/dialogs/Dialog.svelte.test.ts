import { createRawSnippet } from "svelte";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
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
  it("TabとShift+Tabを両端で循環させ、隠れた要素・disabled・inertを除く", async () => {
    // DOM環境にレイアウトはないため、可視候補の矩形だけを補う。
    const rectangles = vi
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockReturnValue(
        Object.assign([new DOMRect(0, 0, 10, 10)], {
          item: () => new DOMRect(0, 0, 10, 10),
        }),
      );
    const view = render(Dialog, {
      title: "循環",
      onClose: vi.fn(),
      children: createRawSnippet(() => ({
        render: () =>
          '<div><button aria-label="内部">内部</button><button aria-label="末尾">末尾</button><button disabled>無効</button><button hidden>非表示</button><div inert><button>操作抑止</button></div><button style="visibility:hidden">不可視</button><div hidden><button>非表示の親</button></div></div>',
      })),
    });
    try {
      const first = screen.getByRole("button", { name: "閉じる" });
      const middle = screen.getByRole("button", { name: "内部" });
      const last = screen.getByRole("button", { name: "末尾" });
      await waitFor(() => expect(first).toHaveFocus());
      last.focus();
      const forward = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      await fireEvent(last, forward);
      expect(forward.defaultPrevented).toBe(true);
      expect(first).toHaveFocus();

      const backward = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      await fireEvent(first, backward);
      expect(backward.defaultPrevented).toBe(true);
      expect(last).toHaveFocus();

      middle.focus();
      const internal = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      await fireEvent(middle, internal);
      expect(internal.defaultPrevented).toBe(false);
    } finally {
      view.unmount();
      rectangles.mockRestore();
    }
  });

  it("表示順の最前面だけを循環させ、閉じた後もドメインのkeydownを合成する", async () => {
    const rectangles = vi
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockReturnValue(
        Object.assign([new DOMRect(0, 0, 10, 10)], {
          item: () => new DOMRect(0, 0, 10, 10),
        }),
      );
    const onkeydown = vi.fn((event: KeyboardEvent) => {
      if (
        (event.ctrlKey && event.key === "s") ||
        (event.shiftKey && event.key === "Tab")
      )
        event.preventDefault();
    });
    // 実際の破棄確認と同じく、後で開く内側のDOM配置を外側より前に用意する。
    const innerTarget = document.createElement("div");
    document.body.appendChild(innerTarget);
    const outer = render(Dialog, {
      title: "外側",
      onClose: vi.fn(),
      onkeydown,
      children: createRawSnippet(() => ({
        render: () => '<button aria-label="外側末尾">外側末尾</button>',
      })),
    });
    let unmountInner: (() => void) | undefined;
    try {
      const outerDialog = screen.getByRole("dialog", { name: "外側" });
      await waitFor(() =>
        expect(
          within(outerDialog).getByRole("button", { name: "閉じる" }),
        ).toHaveFocus(),
      );
      const inner = render(Dialog, {
        target: innerTarget,
        props: {
          title: "内側",
          onClose: vi.fn(),
          children: createRawSnippet(() => ({
            render: () => '<button aria-label="内側末尾">内側末尾</button>',
          })),
        },
      });
      unmountInner = inner.unmount;
      const innerDialog = screen.getByRole("dialog", { name: "内側" });
      const innerFirst = within(innerDialog).getByRole("button", {
        name: "閉じる",
      });
      const innerLast = within(innerDialog).getByRole("button", {
        name: "内側末尾",
      });
      await waitFor(() => expect(innerFirst).toHaveFocus());
      const inactive = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      await fireEvent(outerDialog, inactive);
      expect(inactive.defaultPrevented).toBe(false);
      expect(onkeydown).not.toHaveBeenCalled();
      expect(innerFirst).toHaveFocus();

      innerLast.focus();
      await fireEvent.keyDown(innerLast, { key: "Tab" });
      expect(innerFirst).toHaveFocus();
      inner.unmount();
      unmountInner = undefined;

      const outerFirst = within(outerDialog).getByRole("button", {
        name: "閉じる",
      });
      const outerLast = within(outerDialog).getByRole("button", {
        name: "外側末尾",
      });
      await waitFor(() => expect(outerFirst).toHaveFocus());
      outerLast.focus();
      const save = new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      await fireEvent(outerLast, save);
      expect(save.defaultPrevented).toBe(true);
      expect(onkeydown).toHaveBeenCalledOnce();
      expect(outerLast).toHaveFocus();
      await fireEvent.keyDown(outerLast, { key: "Tab" });
      expect(outerFirst).toHaveFocus();
      expect(onkeydown).toHaveBeenCalledTimes(2);
      await fireEvent.keyDown(outerFirst, { key: "Tab", shiftKey: true });
      expect(outerFirst).toHaveFocus();
      expect(onkeydown).toHaveBeenCalledTimes(3);
    } finally {
      unmountInner?.();
      outer.unmount();
      innerTarget.remove();
      rectangles.mockRestore();
    }
  });

  it.each([
    "内側を閉じてから外側",
    "外側と内側を同時に閉じる",
    "内側と外側を同時に閉じる",
  ])(
    "%sでも、DOM取り外し後に残る画面の起点へフォーカスを戻す",
    async (order) => {
      const opener = document.createElement("button");
      opener.textContent = "編集を開く";
      const innerTarget = document.createElement("div");
      document.body.append(opener, innerTarget);
      opener.focus();
      const outer = render(Dialog, {
        title: "編集の復帰",
        onClose: vi.fn(),
        children: createRawSnippet(() => ({
          render: () => '<input aria-label="復帰先の内容" />',
        })),
      });
      let unmountOuter: (() => void) | undefined = outer.unmount;
      let unmountInner: (() => void) | undefined;
      try {
        const input = screen.getByRole("textbox", { name: "復帰先の内容" });
        await waitFor(() => expect(input).toHaveFocus());
        const inner = render(Dialog, {
          target: innerTarget,
          props: {
            title: "破棄の復帰",
            onClose: vi.fn(),
            children: createRawSnippet(() => ({
              render: () =>
                '<button aria-label="破棄をやめる">キャンセル</button>',
            })),
          },
        });
        unmountInner = inner.unmount;
        const confirmation = screen.getByRole("dialog", { name: "破棄の復帰" });
        await waitFor(() =>
          expect(
            within(confirmation).getByRole("button", { name: "閉じる" }),
          ).toHaveFocus(),
        );
        // 実装と同じく、DOM取り外しを伴う経路で復帰を検査する。
        if (order === "外側と内側を同時に閉じる") {
          unmountOuter?.();
          unmountOuter = undefined;
          inner.unmount();
          unmountInner = undefined;
        } else if (order === "内側と外側を同時に閉じる") {
          inner.unmount();
          unmountInner = undefined;
          unmountOuter?.();
          unmountOuter = undefined;
        } else {
          await inner.rerender({ open: false });
          await waitFor(() => expect(input).toHaveFocus());
          expect(confirmation.isConnected).toBe(false);
          await outer.rerender({ open: false });
        }
        await waitFor(() => expect(opener).toHaveFocus());
      } finally {
        unmountInner?.();
        unmountOuter?.();
        innerTarget.remove();
        opener.remove();
      }
    },
  );
});
