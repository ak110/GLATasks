/**
 * @fileoverview SSE購読のonMountラッパーヘルパー + ポーリングフォールバック機構
 *
 * 各コンポーネントの onMount 内で subscribe → return unsub の定型処理を共通化する。
 * ライフサイクルはコンポーネントのマウント/アンマウントと1対1で対応するため
 * onMount ベースで十分であり、$effect は使用しない。
 *
 * 外部要因でSSE応答が長期間届かない経路に備え、`sse-client.ts` の健全性状態を
 * 購読してポーリングフォールバックを切り替える。健全性が `"unhealthy"` へ遷移した
 * 直後にフォールバックを1回即時実行し、以後30秒間隔のポーリングを継続する。
 * `"healthy"` へ復帰した時点でポーリングを停止する。
 * フォールバック呼び出しがエラーを送出した場合は接続不全とみなし、
 * `connection-recovery.svelte.ts` の `triggerReload` で
 * 入力中はバナー表示、非入力中は即時リロードへ誘導する。
 */

import { onMount } from "svelte";
import {
  subscribe,
  onHealthChange,
  getHealth,
  type HealthState,
} from "./sse-client";
import { triggerReload } from "./connection-recovery.svelte";
import type { SseEventName } from "./sse-events";

type SseHandler = (event: MessageEvent) => void;
type FallbackFn = () => void | Promise<void>;

/** イベント単位の購読仕様（SSE受信ハンドラと不健全時のフォールバック） */
export type SseSubscription = {
  handler: SseHandler;
  fallback?: FallbackFn;
};

// フォールバックポーリング周期（ms）
const FALLBACK_POLL_INTERVAL_MS = 30_000;

/**
 * SSE購読とフォールバックポーリングをセットアップする（テスト容易性のため `onMount` から分離）
 *
 * 戻り値はクリーンアップ関数。`subscribeOnMount` から `onMount` 経由で呼ばれる。
 */
export function setupSseSubscriptions(
  subscriptions: Partial<Record<SseEventName, SseSubscription>>,
): () => void {
  const fallbacks: FallbackFn[] = [];
  const unsubs: Array<() => void> = [];
  for (const [eventName, sub] of Object.entries(subscriptions)) {
    const { handler, fallback } = sub as SseSubscription;
    if (fallback) fallbacks.push(fallback);
    unsubs.push(subscribe(eventName as SseEventName, handler));
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const runFallbacks = async (): Promise<void> => {
    // 直前回のフォールバックがまだ走っている場合は重複起動しない
    if (running) return;
    running = true;
    try {
      for (const fn of fallbacks) {
        try {
          await fn();
        } catch {
          // tRPC呼び出しの失敗（HTTPステータス非200・JSON以外・認証失効など）は
          // 接続不全とみなし、入力中ならバナー表示、非入力中なら即時リロードへ誘導する
          triggerReload();
          return;
        }
      }
    } finally {
      running = false;
    }
  };

  const startPolling = (): void => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void runFallbacks();
    }, FALLBACK_POLL_INTERVAL_MS);
  };

  const stopPolling = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const handleHealth = (state: HealthState): void => {
    if (state === "unhealthy") {
      // "unhealthy" 遷移直後に1回即時実行し、以後30秒間隔のポーリングへ移行する
      void runFallbacks();
      startPolling();
    } else if (state === "healthy") {
      stopPolling();
    }
    // "initial" 遷移時は意図的に何もしない。
    // SSE再接続直後は connect() 内で "initial" へ戻るが、"healthy" 受信までは
    // SSE経路が回復したか確証が無いため、それまでに起動済みのポーリングを継続させる。
  };

  const unsubHealth = onHealthChange(handleHealth);
  // セットアップ時点で既に "unhealthy" の場合へ追従する
  handleHealth(getHealth());

  return () => {
    unsubHealth();
    stopPolling();
    for (const unsub of unsubs) {
      unsub();
    }
  };
}

/**
 * SSEイベントをコンポーネントのライフサイクルに紐付けて購読する
 *
 * onMount 内で subscribe を呼び、アンマウント時に自動解除する。
 * 複数イベントを一括登録する場合は `subscriptions` にオブジェクト形式で渡す。
 *
 * 各 `fallback` はSSE不健全時に呼び出される。SSE経路と同じ再取得処理を
 * 渡すと、SSE途絶時にも30秒間隔で再取得され同期遅延が抑えられる。
 */
export function subscribeOnMount(
  subscriptions: Partial<Record<SseEventName, SseSubscription>>,
): void {
  onMount(() => setupSseSubscriptions(subscriptions));
}
