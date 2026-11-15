/**
 * @fileoverview 操作失敗のエラー通知と接続確認
 *
 * 操作失敗を起点に接続を能動チェックし、応答の横取り（認証画面などによる差し替え）と判定した場合は
 * 個別のエラー通知を出さない。横取りでは複数の操作が続けて失敗し、自動の再読み込みか案内のバナーへ進む前に
 * 同じ原因のエラー通知が何件も並ぶためである。正当なアプリエラー時は判定基盤が ok を返すため通知は省かない。
 */

import { checkConnectivity } from "#lib/client/sse/connection-recovery.svelte.ts";

/** 接続を確かめ、操作失敗のエラー通知を出してよいか（応答の横取りでないか）を返す */
export async function shouldNotifyFailure(): Promise<boolean> {
  return (await checkConnectivity()) !== "intercepted";
}
