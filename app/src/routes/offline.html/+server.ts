/**
 * @fileoverview オフライン画面の配信エンドポイント
 *
 * 接続判定と検出契機の正本は connectivity-check.js に置き、?raw でインライン展開する。
 * Service Worker がオフライン時に追加のスクリプトを取得できないため、キャッシュ対象を増やさない。
 */

import connectivityCheckSource from "$lib/connectivity-check.js?raw";

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

      startConnectivityTriggers(async () => {
        if (await isHealthy()) globalThis.location.reload();
      });

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
