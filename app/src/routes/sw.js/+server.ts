/**
 * @fileoverview サービスワーカー配信エンドポイント
 *
 * オフライン時に offline.html を表示する PWA 機能を提供する。
 * v2.8.0 の FastAPI テンプレートから移植。
 */

const SW_SCRIPT = `\
// offline.html/+server.ts または connectivity-check.js を変更したら更新する。
const OFFLINE_VERSION = 6;
const CACHE_NAME = "offline-v" + OFFLINE_VERSION;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
    })(),
  );
  globalThis.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if ("navigationPreload" in globalThis.registration) {
        await globalThis.registration.navigationPreload.enable();
      }
      // 旧バージョンの offline キャッシュを削除する
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      );
    })(),
  );
  globalThis.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // /healthcheck のナビゲーション（認証画面を開く別ウィンドウ、自動通過を試す非表示iframe）は横取りしない。
  // 通信が遮断された状態でオフライン画面へ置き換えると、ブラウザーや認証画面の案内が表示されなくなるためである。
  if (new URL(event.request.url).pathname === "/healthcheck") return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preloadResponse = await event.preloadResponse;
          if (preloadResponse) {
            return preloadResponse;
          }
          return await fetch(event.request);
        } catch (error) {
          console.log(
            "Fetch failed; returning offline page instead. No action is needed (the offline page is shown).",
            error,
          );
          const cache = await caches.open(CACHE_NAME);
          return await cache.match(OFFLINE_URL);
        }
      })(),
    );
  }
});
`;

export function GET() {
  return new Response(SW_SCRIPT, {
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-cache",
    },
  });
}
