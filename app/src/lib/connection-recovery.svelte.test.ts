/**
 * @fileoverview 接続不全リロード経路のユニットテスト
 *
 * `triggerReload` の入力中／非入力中分岐と `pendingReload` 遷移を、
 * `isUserBusy` の判定対象（INPUT・TEXTAREA・SELECT・contenteditable・
 * aria-modal dialog）ごとに同値分割でカバーする。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Recovery = typeof import("./connection-recovery.svelte");

describe("connection-recovery", () => {
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    reloadMock = vi.fn();
    Object.defineProperty(window.location, "reload", {
      configurable: true,
      value: reloadMock,
    });
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  // 同値分割: 入力中判定パターン
  // 非入力中は即時 reload、入力中は pendingReload=true でバナー待機に分岐する
  it.each([
    {
      label: "非入力中（フォーカスなし・ダイアログなし）",
      setup: () => {},
      expectReload: true,
      expectPending: false,
    },
    {
      label: "INPUT 要素にフォーカス",
      setup: () => {
        const el = document.createElement("input");
        document.body.appendChild(el);
        el.focus();
      },
      expectReload: false,
      expectPending: true,
    },
    {
      label: "TEXTAREA 要素にフォーカス",
      setup: () => {
        const el = document.createElement("textarea");
        document.body.appendChild(el);
        el.focus();
      },
      expectReload: false,
      expectPending: true,
    },
    {
      label: "SELECT 要素にフォーカス",
      setup: () => {
        const el = document.createElement("select");
        document.body.appendChild(el);
        el.focus();
      },
      expectReload: false,
      expectPending: true,
    },
    {
      label: "contenteditable 要素にフォーカス",
      setup: () => {
        const el = document.createElement("div");
        el.setAttribute("contenteditable", "true");
        document.body.appendChild(el);
        el.focus();
      },
      expectReload: false,
      expectPending: true,
    },
    {
      label: 'role="dialog" aria-modal="true" 要素が存在',
      setup: () => {
        const el = document.createElement("div");
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-modal", "true");
        document.body.appendChild(el);
      },
      expectReload: false,
      expectPending: true,
    },
  ])(
    "triggerReload: $label → reload=$expectReload / pendingReload=$expectPending",
    async ({ setup, expectReload, expectPending }) => {
      setup();
      const recovery: Recovery = await import("./connection-recovery.svelte");
      recovery.triggerReload();

      if (expectReload) {
        expect(reloadMock).toHaveBeenCalledTimes(1);
      } else {
        expect(reloadMock).not.toHaveBeenCalled();
      }
      expect(recovery.connectivityState.pendingReload).toBe(expectPending);
    },
  );

  it("非入力中の triggerReload は pendingReload を変更しない", async () => {
    const recovery: Recovery = await import("./connection-recovery.svelte");
    expect(recovery.connectivityState.pendingReload).toBe(false);
    recovery.triggerReload();
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(recovery.connectivityState.pendingReload).toBe(false);
  });
});
