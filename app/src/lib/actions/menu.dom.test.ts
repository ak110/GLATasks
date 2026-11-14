import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { menuBehavior } from "./menu.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("行メニュー", () => {
  it("リンクとコマンドを矢印・Home・Endで移動できる", async () => {
    const node = document.createElement("div");
    node.innerHTML =
      '<button>アカウント</button><div data-menu-frame><a href="/account/security">設定</a><form><button>ログアウト</button></form></div>';
    document.body.appendChild(node);
    const action = menuBehavior(node, { open: true, onClose: vi.fn() });
    await tick();
    const trigger = node.querySelector("button")!;
    const link = node.querySelector("a")!;
    const logout = node.querySelector("form button")!;
    expect(link).toHaveAttribute("role", "menuitem");
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(link).toHaveFocus();
    link.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
    expect(logout).toHaveFocus();
    logout.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    expect(link).toHaveFocus();
    action.destroy();
  });
  it("ARIAを同期し、外側クリックとEscだけで閉じる", async () => {
    const node = document.createElement("div");
    node.innerHTML =
      "<button>操作</button><div data-menu-frame><button>編集</button></div>";
    document.body.appendChild(node);
    const onClose = vi.fn();
    const action = menuBehavior(node, { open: true, onClose });
    await tick();
    expect(node.firstElementChild).toHaveAttribute("aria-expanded", "true");
    expect(node.querySelector("[data-menu-frame]")).toHaveAttribute(
      "role",
      "menu",
    );
    expect(node.querySelector("[data-menu-frame] button")).toHaveAttribute(
      "role",
      "menuitem",
    );
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
    action.update({ open: false, onClose });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    action.destroy();
  });
});
