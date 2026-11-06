/**
 * @fileoverview Tanstack Query クライアント設定
 */

import { browser } from "$app/env";
import {
  QueryClient,
  QueryCache,
  MutationCache,
  type Query,
} from "@tanstack/svelte-query";
import { tick } from "svelte";
import {
  showErrorToast,
  dismissToast,
} from "#lib/client/ui/toast-store.svelte.ts";
import { checkConnectivity } from "#lib/client/sse/connection-recovery.svelte.ts";
import { extractErrorMessage } from "#lib/client/ui/extract-error-message.ts";

type NotificationQuery = Query<unknown, unknown, unknown>;
const queryToasts = new WeakMap<object, number>();
const queryCache = new QueryCache({
  onError: (error, query) => {
    if (!browser) return;
    void checkConnectivity();
    void presentQueryError(error, query);
  },
});

export const queryClient = new QueryClient({
  // 個別 onError は既定の onError を上書きするが、Cache のグローバル onError は
  // 個別処理の有無に左右されず全 query・mutation のエラーで必ず呼ばれる。
  // エラー通知と接続の能動チェックをここへ集約し、保存失敗時の通知欠落を解消する。
  queryCache,
  mutationCache: new MutationCache({ onError: (error) => handleError(error) }),
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

// 画面到達で別Queryのobserverだけが変わる場合も、可視DOMのhashに対応する通知を回収する。
queryCache.subscribe((event) => {
  if (event.type === "updated" && event.action.type === "success") {
    dismissQueryToast(event.query);
    return;
  }
  if (!browser) return;
  if (
    event.type === "observerAdded" ||
    event.type === "observerOptionsUpdated" ||
    event.type === "observerResultsUpdated"
  ) {
    void reconcileVisibleQueryErrorToasts();
  }
});

/** Query更新を伴わない表示切替でも、描画されたinlineへ自身の通知を集約する。 */
export async function reconcileVisibleQueryErrorToasts(): Promise<void> {
  if (!browser) return;
  await tick();
  document
    .querySelectorAll<HTMLElement>("[data-query-error-key]")
    .forEach((element) => {
      if (element.getClientRects().length === 0) return;
      const key = element.dataset.queryErrorKey;
      const query = key ? queryCache.get(key) : undefined;
      if (query) dismissQueryToast(query);
    });
}

function hasVisibleInline(queryHash: string): boolean {
  return [
    ...document.querySelectorAll<HTMLElement>("[data-query-error-key]"),
  ].some(
    (element) =>
      element.dataset.queryErrorKey === queryHash &&
      element.getClientRects().length > 0,
  );
}

async function presentQueryError(error: unknown, query: NotificationQuery) {
  await tick();
  if (query.state.status !== "error" || query.state.error !== error) return;
  dismissQueryToast(query);
  if (!hasVisibleInline(query.queryHash)) {
    queryToasts.set(query, showErrorToast(extractErrorMessage(error)));
  }
}

function dismissQueryToast(query: object) {
  const id = queryToasts.get(query);
  if (id === undefined) return;
  dismissToast(id);
  queryToasts.delete(query);
}

/** mutation等の失敗通知と接続確認 */
function handleError(error: unknown): void {
  showErrorToast(extractErrorMessage(error));
  // 操作失敗を起点に接続を能動チェックする。
  // 正当なアプリエラー時は判定基盤が ok を返すため検出は誤発火しない。
  void checkConnectivity();
}
