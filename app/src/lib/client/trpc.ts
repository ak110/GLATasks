import { createTRPCClient, httpBatchLink, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "#lib/server/trpc.ts";
import { encrypt, decrypt } from "#lib/crypto.ts";

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;

export const tabId = crypto.randomUUID();

let encryptKey: string | null = null;

export function setEncryptKey(key: string) {
  encryptKey = key;
}

const encryptionLink: TRPCLink<AppRouter> = () => {
  return ({ next, op }) => {
    return observable((observer) => {
      let pending: Promise<void> | null = null;

      const unsubscribe = next(op).subscribe({
        next: (value) => {
          pending = (async () => {
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

function isBatchInputBody(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => /^\d+$/.test(key))
  );
}

async function encryptedFetch(
  url: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
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
