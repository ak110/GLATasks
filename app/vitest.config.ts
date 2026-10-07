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
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

const libAlias = {
  "#lib": path.resolve(import.meta.dirname, "src/lib"),
};

export default defineConfig({
  test: {
    projects: [
      {
        // Node環境プロジェクト（既存テスト）
        resolve: { alias: libAlias },
        test: {
          name: "node",
          root: import.meta.dirname,
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
        plugins: [
          svelte({ configFile: false, preprocess: vitePreprocess() }),
          svelteTesting(),
        ],
        resolve: { alias: libAlias },
        test: {
          name: "dom",
          root: import.meta.dirname,
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
          // `$app/*` を import するコンポーネントは、このprojectが sveltekit()
          // プラグインを使わないため解決できない。該当コンポーネントの表示と
          // 操作は app/tests 配下のPlaywrightテストで検証する。
          // @testing-library/jest-dom のカスタムマッチャーを全テストで有効化する
          setupFiles: ["src/test-setup.ts"],
        },
      },
    ],
  },
});
