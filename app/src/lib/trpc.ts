/**
 * @fileoverview tRPC クライアント（ブラウザ側）
 */

import { createTRPCClient, httpBatchLink, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "$lib/server/trpc";
import { encrypt, decrypt } from "$lib/crypto";

/** tRPC ルーターの戻り値型マップ。クライアント側で型を導出する際に使用する。 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

// タブ固有のID（SSEイベントの発信元識別に使用）
export const tabId = crypto.randomUUID();

// 暗号化鍵を保持するグローバル変数
let encryptKey: string | null = null;

/**
 * 暗号化鍵を設定する（+layout.svelteから呼ばれる）
 */
export function setEncryptKey(key: string) {
  encryptKey = key;
}

/**
 * 暗号化リンク: リクエストを暗号化し、レスポンスを復号化する
 */
const encryptionLink: TRPCLink<AppRouter> = () => {
  return ({ next, op }) => {
    return observable((observer) => {
      // 非同期の next ハンドラが完了する前に complete が呼ばれないようにする
      let pending: Promise<void> | null = null;

      const unsubscribe = next(op).subscribe({
        next: (value) => {
          pending = (async () => {
            // レスポンスが暗号化されている場合は復号化
            if (
              value.result.type === "data" &&
              typeof value.result.data === "object" &&
              value.result.data !== null &&
              "encrypted" in value.result.data &&
              typeof value.result.data.encrypted === "string"
            ) {
              if (!encryptKey) {
                observer.error(new Error("Encryption key not set") as never);
                return;
              }
              try {
                const decryptedStr = await decrypt(
                  value.result.data.encrypted,
                  encryptKey,
                );
                const decryptedData = JSON.parse(decryptedStr);
                observer.next({
                  ...value,
                  result: {
                    ...value.result,
                    data: decryptedData,
                  },
                });
              } catch (error) {
                observer.error(
                  new Error("Failed to decrypt response", {
                    cause: error,
                  }) as never,
                );
              }
            } else {
              observer.next(value);
            }
          })();
        },
        error: (err) => observer.error(err),
        complete: () => {
          const done = () => observer.complete();
          if (pending) {
            pending.then(done, done);
          } else {
            done();
          }
        },
      });
      return unsubscribe;
    });
  };
};

/**
 * リクエスト暗号化用のfetch wrapper
 */
async function encryptedFetch(
  url: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // タブIDヘッダーを付与（SSEイベントの発信元識別用）
  const headers = new Headers(init?.headers);
  headers.set("X-Tab-Id", tabId);
  init = { ...init, headers };

  if (init.body && encryptKey) {
    try {
      const bodyObj = JSON.parse(init.body as string);
      // バッチリクエストの各アイテムを暗号化
      if (Array.isArray(bodyObj)) {
        const encryptedBatch = await Promise.all(
          bodyObj.map(async (item) => {
            if (item.input !== undefined) {
              const encryptedInput = await encrypt(
                JSON.stringify(item.input),
                encryptKey!,
              );
              return {
                ...item,
                input: { encrypted: encryptedInput },
              };
            }
            return item;
          }),
        );
        init = {
          ...init,
          body: JSON.stringify(encryptedBatch),
        };
      } else if (bodyObj.input !== undefined) {
        // 単一リクエストの場合
        const encryptedInput = await encrypt(
          JSON.stringify(bodyObj.input),
          encryptKey,
        );
        init = {
          ...init,
          body: JSON.stringify({
            ...bodyObj,
            input: { encrypted: encryptedInput },
          }),
        };
      }
    } catch (error) {
      console.error("Failed to encrypt request:", error);
    }
  }
  return fetch(url, init);
}

export const trpc = createTRPCClient<AppRouter>({
  links: [
    encryptionLink,
    httpBatchLink({
      url: "/api/trpc",
      fetch: encryptedFetch,
    }),
  ],
});
