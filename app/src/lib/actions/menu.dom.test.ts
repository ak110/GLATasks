import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { menuBehavior } from "./menu.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("行メニュー", () => {
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
