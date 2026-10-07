/**
 * @fileoverview 端末時計の分の切り替わりごとに処理を呼ぶタイマー
 */

/**
 * 端末時計の分が切り替わるたびに`callback`を呼ぶ。戻り値の関数で停止する。
 * 一定間隔の`setInterval`と異なり、時刻を分単位で表示する欄と表示上の分がずれない
 */
export function startMinuteTicker(callback: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    const now = Date.now();
    const nextMinute = Math.floor(now / 60_000) * 60_000 + 60_000;
    timer = setTimeout(() => {
      callback();
      schedule();
    }, nextMinute - now);
  };
  schedule();
  return () => clearTimeout(timer);
}
