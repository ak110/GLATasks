/**
 * @fileoverview tRPC クライアント（ブラウザ側）
 */

import { createTRPCClient, httpBatchLink, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "#lib/server/trpc.ts";
import { encrypt, decrypt } from "#lib/crypto.ts";

/** tRPC ルーターの戻り値型マップ。クライアント側で型を導出する際に使用する。 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
/** tRPC入力を画面のmutationへ渡すための型マップ。 */
export type RouterInputs = inferRouterInputs<AppRouter>;

// タブ固有のID（SSEイベントの発信元識別に使用）
export const tabId = crypto.randomUUID();

let encryptKey: string | null = null;

/**
 * 暗号化鍵を設定する（+layout.svelteから呼ばれる）
 */
export function setEncryptKey(key: string) {
  encryptKey = key;
}

/**
 * 暗号化リンク: リクエストを暗号化し、レスポンスを復号する
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
                  new Error(
                    "サーバーからの応答を復号できませんでした。サーバーの暗号鍵が変わった可能性があります。ページを再読み込みして暗号鍵を取得し直してください",
                    { cause: error },
                  ) as never,
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
 * `httpBatchLink`のPOST本文（操作の添字を数値キーにした辞書）かを判定する。
 */
function isBatchInputBody(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => /^\d+$/.test(key))
  );
}

/**
 * リクエストを暗号化するfetch wrapper
 *
 * `httpBatchLink`はmutationの入力を`{"0": 入力, "1": 入力, ...}`の辞書としてPOST本文へ載せる
 * （単一の呼び出しも同じ形）。各入力を`{ encrypted: 暗号文 }`へ置き換え、数値キーを保つ。
 * サーバーの`withEncryption`は操作ごとの入力として受け取って復号する。
 * GETのquery入力はURLで送られ本文を持たないため、ここでは扱わない。
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
      const bodyObj: unknown = JSON.parse(init.body as string);
      if (isBatchInputBody(bodyObj)) {
        const key = encryptKey;
        const encryptedEntries = await Promise.all(
          Object.entries(bodyObj).map(async ([index, input]) => [
            index,
            { encrypted: await encrypt(JSON.stringify(input), key) },
          ]),
        );
        init = {
          ...init,
          body: JSON.stringify(Object.fromEntries(encryptedEntries)),
        };
      }
    } catch (error) {
      console.error(
        "送信内容を暗号化できなかったため、暗号化せずに送信しました。操作は続きます。繰り返し出力される場合はページを再読み込みしてください:",
        error,
      );
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
