/**
 * @fileoverview tRPC SvelteKit アダプター
 */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { RequestHandler } from "@sveltejs/kit";
import { appRouter } from "#lib/server/trpc.ts";

export const GET: RequestHandler = async (event) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: event.request,
    router: appRouter,
    createContext: () => ({
      userId: event.locals.user_id ?? null,
      tabId: event.request.headers.get("x-tab-id"),
    }),
    onError: ({ error, path }) => {
      // 想定内のエラー（認証・バリデーション等）はログ不要
      if (error.code !== "INTERNAL_SERVER_ERROR") return;
      console.error(
        `tRPC エラー [${path}]: 呼び出し元へinternal_error（時間をおいた再試行の案内）を返しました。続く例外のスタックトレースで失敗した箇所を確認してください:`,
        error.cause ?? error,
      );
    },
  });
};

export const POST: RequestHandler = GET;
