import { execFileSync } from "node:child_process";
import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/**
 * ビルド時に SvelteKit の kit.version.name に埋め込むバージョン識別子を解決する。
 *
 * git short hash を第一候補とし、.git が無い環境 (CI の shallow clone やコンテナ内ビルド) では
 * 環境変数 GIT_COMMIT、最終手段として現在時刻を使う。ここで取得した値はクライアントの
 * __sveltekit/version.json に出力され、updated store によるデプロイ検知に利用される。
 *
 * SvelteKit は SSR ビルドの後に同一プロセスでクライアントビルドを起動する際、
 * svelte.config.js を再評価する。`Date.now()` フォールバック時に評価ごとの値が異なると
 * SSR HTML と client チャンクで __sveltekit_<hash> 識別子が不一致となり、ハイドレーション時に
 * `globalThis.__sveltekit_<hash>.data` で TypeError が発生して全 tRPC リクエストが発火しない。
 * 同一プロセス内の再評価を吸収するため、初回解決値を env var に保存して再利用する。
 */
function resolveVersion() {
  if (process.env.SVELTEKIT_VERSION_NAME) {
    return process.env.SVELTEKIT_VERSION_NAME;
  }
  let resolved;
  try {
    resolved = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    resolved = process.env.GIT_COMMIT ?? String(Date.now());
  }
  process.env.SVELTEKIT_VERSION_NAME = resolved;
  return resolved;
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ out: "build" }),
    // CSRF 対策は hooks.server.ts の Sec-Fetch-Site チェックで行うため、
    // SvelteKit 組み込みの Origin チェックは無効化する（リバースプロキシ経由で誤検知するため）
    csrf: { trustedOrigins: ["*"] },
    // 新デプロイ検知のためのバージョン設定。
    // クライアントは pollInterval ごとに __sveltekit/version.json を確認し、
    // 差異があれば $app/state の updated store が true になる。
    version: {
      name: resolveVersion(),
      pollInterval: 300_000,
    },
  },
};

export default config;
