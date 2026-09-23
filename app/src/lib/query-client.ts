/**
 * @fileoverview Tanstack Query クライアント設定
 */

import { browser } from "$app/environment";
import { QueryClient, QueryCache, MutationCache } from "@tanstack/svelte-query";
import { showErrorToast } from "$lib/toast-store.svelte";
import { checkConnectivity } from "$lib/connection-recovery.svelte";
import { extractErrorMessage } from "$lib/extract-error-message";

export const queryClient = new QueryClient({
  // 個別 onError は既定の onError を上書きするが、Cache のグローバル onError は
  // 個別処理の有無に左右されず全 query・mutation のエラーで必ず呼ばれる。
  // エラー通知と接続の能動チェックをここへ集約し、保存失敗時の通知欠落を解消する。
  queryCache: new QueryCache({ onError: handleError }),
  mutationCache: new MutationCache({ onError: handleError }),
  defaultOptions: {
    queries: {
      // svelte-query 6.2.3以降はSSR中もqueryを購読して取得を始める。
      // サーバー上で取得が失敗すると、エラー処理の接続チェックがブラウザ専用API（document）へ触れて
      // Node.jsプロセスが例外終了するため、取得はブラウザでだけ行う。
      // 個別にenabledを指定するqueryは、SSR時の初期状態で条件が偽になることを前提とする
      enabled: browser,
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
