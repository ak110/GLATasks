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
import { shouldNotifyFailure } from "#lib/client/operation-error-notice.ts";
import { CONNECTIVITY_RECOVERED_EVENT } from "#lib/client/sse/connection-recovery.svelte.ts";
import { extractErrorMessage } from "#lib/client/ui/extract-error-message.ts";

type NotificationQuery = Query<unknown, unknown, unknown>;
const queryToasts = new WeakMap<object, number>();
const queryCache = new QueryCache({
  onError: (error, query) => {
    if (!browser) return;
    void presentQueryError(error, query);
  },
});

export const queryClient = new QueryClient({
  queryCache,
  mutationCache: new MutationCache({ onError: (error) => handleError(error) }),
  defaultOptions: {
    queries: {
      // svelte-query 6.2.3以降はSSR中もqueryを購読して取得を始める。
      // サーバー上で取得が失敗すると、エラー処理の接続チェックがブラウザ専用API（document）へ触れて
      // Node.jsプロセスが例外終了するため、取得はブラウザでだけ行う。
      // 個別にenabledを指定するqueryは、SSR時の初期状態で条件が偽になることを前提とする
      enabled: browser,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: "always",
      retry: 1,
    },
  },
});

if (browser) {
  window.addEventListener(CONNECTIVITY_RECOVERED_EVENT, () => {
    void queryClient.invalidateQueries();
  });
}

queryCache.subscribe((event) => {
  if (event.type === "updated" && event.action.type === "success") {
    dismissQueryToast(event.query);
    return;
  }
  if (!browser) return;
  if (
    (event.type === "observerRemoved" ||
      event.type === "observerOptionsUpdated") &&
    event.query.meta?.dismissToastOnDeactivate &&
    !event.query.isActive()
  ) {
    dismissQueryToast(event.query);
  }
  if (
    event.type === "observerAdded" ||
    event.type === "observerOptionsUpdated" ||
    event.type === "observerResultsUpdated"
  ) {
    void reconcileVisibleQueryErrorToasts();
  }
});

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
  if (!(await shouldNotifyFailure())) return;
  await tick();
  if (query.state.status !== "error" || query.state.error !== error) return;
  dismissQueryToast(query);
  if (query.meta?.dismissToastOnDeactivate && !query.isActive()) return;
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

function handleError(error: unknown): void {
  void (async () => {
    if (await shouldNotifyFailure()) showErrorToast(extractErrorMessage(error));
  })();
}
