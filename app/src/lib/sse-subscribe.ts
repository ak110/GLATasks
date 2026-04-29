/**
 * @fileoverview SSE購読のonMountラッパーヘルパー
 *
 * 各コンポーネントの onMount 内で subscribe → return unsub の定型処理を共通化する。
 * ライフサイクルはコンポーネントのマウント/アンマウントと1対1で対応するため
 * onMount ベースで十分であり、$effect は使用しない。
 */

import { onMount } from "svelte";
import { subscribe } from "./sse-client";
import type { SseEventName } from "./sse-events";

type SseHandler = (event: MessageEvent) => void;

/**
 * SSEイベントをコンポーネントのライフサイクルに紐付けて購読する
 *
 * onMount 内で subscribe を呼び、アンマウント時に自動解除する。
 * 複数イベントを一括登録する場合は `subscriptions` にオブジェクト形式で渡す。
 */
export function subscribeOnMount(
  subscriptions: Partial<Record<SseEventName, SseHandler>>,
): void {
  onMount(() => {
    const unsubs = Object.entries(subscriptions).map(([eventName, handler]) =>
      subscribe(eventName as SseEventName, handler as SseHandler),
    );
    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  });
}
