import { tick } from "svelte";

type MenuState = { open: boolean; onClose: () => void };

/** トリガーとメニューを囲む要素で、ARIAと外側クリック・Escを管理する。 */
export function menuBehavior(node: HTMLElement, initial: MenuState) {
  let state = initial;
  function update(next: MenuState) {
    state = next;
    const trigger = node.querySelector("button");
    trigger?.setAttribute("aria-haspopup", "menu");
    trigger?.setAttribute("aria-expanded", String(state.open));
    void tick().then(() => {
      const menu = node.querySelector<HTMLElement>("[data-menu-frame]");
      menu?.setAttribute("role", "menu");
      for (const button of menu?.querySelectorAll("button, a[href]") ?? [])
        button.setAttribute("role", "menuitem");
    });
  }
  function outside(event: MouseEvent) {
    if (
      state.open &&
      event.target instanceof Node &&
      !node.contains(event.target)
    )
      state.onClose();
  }
  function escape(event: KeyboardEvent) {
    if (!state.open || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    state.onClose();
    node.querySelector("button")?.focus();
  }
  function keyboard(event: KeyboardEvent) {
    if (
      !state.open ||
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
    )
      return;
    const items = [
      ...node.querySelectorAll<HTMLElement>(
        "[data-menu-frame] button:not(:disabled), [data-menu-frame] a[href]",
      ),
    ];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) %
            items.length;
    event.preventDefault();
    items[next].focus();
  }
  update(initial);
  document.addEventListener("mousedown", outside);
  document.addEventListener("keydown", escape);
  node.addEventListener("keydown", keyboard);
  return {
    update,
    destroy() {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
      node.removeEventListener("keydown", keyboard);
    },
  };
}
