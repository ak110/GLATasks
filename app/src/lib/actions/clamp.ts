export function clampDetector(
  node: HTMLElement,
  onClamp: (isClamped: boolean) => void,
): { destroy: () => void } {
  const check = () => {
    const isClamped = node.scrollHeight > node.clientHeight;
    onClamp(isClamped);
  };
  check();
  const observer = new ResizeObserver(check);
  observer.observe(node);
  return { destroy: () => observer.disconnect() };
}
