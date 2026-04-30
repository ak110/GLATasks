/**
 * @fileoverview Vitestのプロジェクト分割設定
 *
 * - node: Node環境テスト（既存の *.test.ts）
 * - dom:  DOM環境テスト（*.svelte.test.ts / *.dom.test.ts）
 *
 * DOM環境テストでのみ @sveltejs/vite-plugin-svelte と
 * @testing-library/svelte の svelteTesting プラグインを適用し、
 * 既存のNode環境テストには影響を与えない。
 */
import * as path from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

// SvelteKit の $lib エイリアスを手動で解決するための設定。
// dom project は @sveltejs/vite-plugin-svelte が自動解決するが、
// node project では手動設定が必要になる。
const libAlias = {
  $lib: path.resolve("./app/src/lib"),
};

export default defineConfig({
  test: {
    projects: [
      {
        // Node環境プロジェクト（既存テスト）
        resolve: { alias: libAlias },
        test: {
          name: "node",
          root: "./app",
          environment: "node",
          globals: true,
          include: ["src/**/*.test.{js,ts}"],
          exclude: [
            "**/node_modules/**",
            "tests/**",
            "**/.{cache,build,svelte-kit}/**",
            "src/**/*.svelte.test.{js,ts}",
            "src/**/*.dom.test.{js,ts}",
          ],
        },
      },
      {
        // DOM環境プロジェクト（Svelteコンポーネントテスト）
        // svelte.config.js はルートからの相対パスで明示的に指定する
        plugins: [
          svelte({ configFile: "app/svelte.config.js" }),
          svelteTesting(),
        ],
        resolve: { alias: libAlias },
        test: {
          name: "dom",
          root: "./app",
          environment: "happy-dom",
          globals: true,
          include: [
            "src/**/*.svelte.test.{js,ts}",
            "src/**/*.dom.test.{js,ts}",
          ],
          exclude: [
            "**/node_modules/**",
            "tests/**",
            "**/.{cache,build,svelte-kit}/**",
          ],
          // @testing-library/jest-dom のカスタムマッチャーを全テストで有効化する
          setupFiles: ["src/test-setup.ts"],
        },
      },
    ],
  },
});
