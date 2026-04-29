/**
 * @fileoverview line-clamp によるテキスト折りたたみ検知アクション
 */

/**
 * DOM要素が line-clamp によりクランプされているかどうかを検知するSvelteアクション。
 *
 * `scrollHeight > clientHeight` の比較でクランプ状態を判定し、
 * ResizeObserver でサイズ変化を監視して再判定する。
 *
 * @param node - 監視対象の HTML 要素
 * @param onClamp - クランプ状態が変化したときに呼ばれるコールバック。
 *   `true`: クランプされている、`false`: クランプされていない
 */
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
