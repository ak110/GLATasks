/**
 * @fileoverview Tanstack Query クライアント設定
 */

import { QueryClient } from "@tanstack/svelte-query";
import { showErrorToast } from "$lib/toast-store.svelte";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5分間はキャッシュ有効
      gcTime: 10 * 60 * 1000, // 10分間はガベージコレクション対象外
      refetchOnWindowFocus: "always",
      retry: 1,
    },
    mutations: {
      onError: (error) => {
        showErrorToast(extractErrorMessage(error));
      },
    },
  },
});

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
