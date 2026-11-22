export const DIALOG_OPENED_EVENT = "glatasks:dialog-opened";

export function notificationLayer(node: HTMLElement) {
  function show() {
    if (!node.isConnected) return;
    if (node.matches(":popover-open")) node.hidePopover();
    node.showPopover();
  }
  show();
  document.addEventListener(DIALOG_OPENED_EVENT, show);
  return () => {
    document.removeEventListener(DIALOG_OPENED_EVENT, show);
    if (node.matches(":popover-open")) node.hidePopover();
  };
}
