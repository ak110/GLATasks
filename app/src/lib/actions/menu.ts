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
      for (const button of menu?.querySelectorAll("button") ?? [])
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
  update(initial);
  document.addEventListener("mousedown", outside);
  document.addEventListener("keydown", escape);
  return {
    update,
    destroy() {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    },
  };
}
