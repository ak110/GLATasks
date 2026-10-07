/**
 * @fileoverview 接続・同期経路のデバッグログヘルパー
 *
 * SSE接続の確立・再接続・切断、イベント受信、健全性の状態遷移、
 * フォールバックポーリング、接続の能動チェック、タスク・リスト同期といった
 * 接続・同期経路の挙動を `console.debug` で観測可能にする。
 * 平時はコンソールの詳細レベル表示でのみ現れ、ノイズを抑えつつ調査時に追跡できる。
 *
 * 出力体裁を本ファイルへ一元化し、常時出力を将来フラグ制御へ切り替える場合も
 * 本ファイルのみの変更で済むようにする。
 */

/** デバッグログのカテゴリ。接続・同期経路ごとに区別する */
export type DebugLogCategory = "sse" | "fallback" | "connectivity" | "sync";

/**
 * 接続・同期経路のデバッグ情報を `console.debug` へ整形出力する。
 *
 * `[glatasks:<カテゴリ>] <事象名>` の体裁で出力し、付随データがある場合は第2引数として渡す。
 */
export function debugLog(
  category: DebugLogCategory,
  event: string,
  data?: Record<string, unknown>,
): void {
  const label = `[glatasks:${category}] ${event}`;
  if (data === undefined) {
    console.debug(label);
  } else {
    console.debug(label, data);
  }
}
