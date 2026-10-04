import { execFileSync } from "node:child_process";
import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/** SSRとクライアントのビルドで同じバージョン名を使う。 */
function resolveVersion(): string {
  if (process.env.SVELTEKIT_VERSION_NAME) {
    return process.env.SVELTEKIT_VERSION_NAME;
  }
  let resolved: string;
  try {
    resolved = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    resolved = process.env.GIT_COMMIT ?? String(Date.now());
  }
  // Vite設定の再評価でも、時刻による代替値が変わらないように保持する。
  process.env.SVELTEKIT_VERSION_NAME = resolved;
  return resolved;
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter({ out: "build" }),
      // APIのCSRF対策はhooks.server.tsのFetch Metadata検査で行う。
      csrf: { trustedOrigins: ["*"] },
      version: { name: resolveVersion(), pollInterval: 300_000 },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
    fs: {
      allow: [".."],
    },
  },
  ssr: {
    // rrule は "exports" フィールドを持たない CommonJS パッケージであり、
    // Vite の既定の外部化判定では named export（rrulestr 等）を正しく解決できない
    // （SyntaxError: Named export 'rrulestr' not found）。noExternal で
    // Viteの変換パイプラインを通すことで interop を正しく機能させる。
    noExternal: ["rrule"],
  },
});
