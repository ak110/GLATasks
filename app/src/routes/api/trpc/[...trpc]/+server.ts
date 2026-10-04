/**
 * @fileoverview tRPC SvelteKit アダプター
 */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { RequestHandler } from "@sveltejs/kit";
import { appRouter } from "#lib/server/trpc.ts";
import { getEncryptKey } from "#lib/server/env.ts";

export const GET: RequestHandler = async (event) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: event.request,
    router: appRouter,
    createContext: () => ({
      event,
      userId: event.locals.user_id ?? null,
      encryptKey: getEncryptKey(),
      tabId: event.request.headers.get("x-tab-id"),
    }),
    onError: ({ error, path }) => {
      // 想定内のエラー（認証・バリデーション等）はログ不要
      if (error.code !== "INTERNAL_SERVER_ERROR") return;
      console.error(`tRPC エラー [${path}]:`, error.cause ?? error);
    },
  });
};

export const POST: RequestHandler = GET;
