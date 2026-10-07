// サーバー時刻オフセット（ms）: サーバー時刻 = Date.now() + offset
let serverOffset = 0;
// オフセット変更通知コールバック
const offsetListeners = new Set<(offset: number) => void>();

/** サーバー時刻オフセット（ms）を取得する */
export function getServerOffset(): number {
  return serverOffset;
}

/** サーバー時刻オフセット（ms）を設定し、リスナーに通知する */
export function setServerOffset(value: number): void {
  serverOffset = value;
  for (const cb of offsetListeners) {
    cb(value);
  }
}

/** オフセット変更時のコールバックを登録する（戻り値は解除関数） */
export function onOffsetChange(cb: (offset: number) => void): () => void {
  offsetListeners.add(cb);
  return () => offsetListeners.delete(cb);
}
