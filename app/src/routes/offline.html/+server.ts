/**
 * @fileoverview オフライン画面の配信エンドポイント
 *
 * 接続判定と検出契機の正本は connectivity-check.js に置き、?raw でインライン展開する。
 * Service Worker がオフライン時に追加のスクリプトを取得できないため、キャッシュ対象を増やさない。
 */

import connectivityCheckSource from "#lib/client/sse/connectivity-check.js?raw";

const HTML = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />

    <title>GLATasks(オフライン)</title>

    <!-- inline the webpage's stylesheet -->
    <style>
      body {
        font-family: helvetica, arial, sans-serif;
        margin: 2em;
      }

      h1 {
        font-style: italic;
        color: #373fff;
      }

      p {
        margin-block: 1rem;
      }

      button {
        display: block;
      }
    </style>
  </head>
  <body>
    <h1>You are offline</h1>

    <p>Click the button below to try reloading.</p>
    <button type="button">⤾ Reload</button>

    <!-- inline the webpage's javascript file -->
    <script type="module">
      ${connectivityCheckSource}

      // 健全を確認してから再読み込みし、通信断のままオフライン画面へ戻らないようにする。
      // Service Workerは元のURLの応答としてこの画面を返すため、通常は再読み込みで元の画面へ戻る。
      // この画面のURLを直接開いた場合は、再読み込みしても表示直後の判定で再び再読み込みを繰り返すため、トップ画面へ移る。
      startConnectivityTriggers(
        async () => {
          if ((await classifyHealth()) !== "healthy") return;
          if (globalThis.location.pathname === "/offline.html") globalThis.location.replace("/");
          else globalThis.location.reload();
        },
        { intervalMs: OFFLINE_POLL_INTERVAL_MS, immediate: true },
      );

      document.querySelector("button").addEventListener("click", () => {
        globalThis.location.reload();
      });
    </script>
  </body>
</html>`;

export function GET() {
  return new Response(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
