/**
 * @fileoverview Tanstack Query クライアント設定
 */

import { QueryClient, QueryCache, MutationCache } from "@tanstack/svelte-query";
import { showErrorToast } from "$lib/toast-store.svelte";
import { checkConnectivity } from "$lib/connection-recovery.svelte";

export const queryClient = new QueryClient({
  // 個別 onError は既定の onError を上書きするが、Cache のグローバル onError は
  // 個別処理の有無に左右されず全 query・mutation のエラーで必ず呼ばれる。
  // エラー通知と接続の能動チェックをここへ集約し、保存失敗時の通知欠落を解消する。
  queryCache: new QueryCache({ onError: handleError }),
  mutationCache: new MutationCache({ onError: handleError }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5分間はキャッシュ有効
      gcTime: 10 * 60 * 1000, // 10分間はガベージコレクション対象外
      refetchOnWindowFocus: "always",
      retry: 1,
    },
  },
});

/** query・mutation のエラー共通処理。トースト通知し、接続を能動チェックする */
function handleError(error: unknown): void {
  showErrorToast(extractErrorMessage(error));
  // 操作失敗を起点に接続を能動チェックする。
  // 正当なアプリエラー時は判定基盤が ok を返すため検出は誤発火しない。
  void checkConnectivity();
}

/** tRPCエラーからユーザー向けメッセージを抽出する */
function extractErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "エラーが発生しました";

  // tRPC の ZodValidationError: message が JSON 配列文字列になっている
  try {
    const parsed = JSON.parse(error.message);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].message) {
      return parsed[0].message;
    }
  } catch {
    // JSON でなければそのまま使う
  }

  return error.message || "エラーが発生しました";
}
