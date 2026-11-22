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
          setupFiles: ["src/test-setup.ts"],
        },
      },
    ],
  },
});
