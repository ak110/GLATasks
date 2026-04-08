import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: "./app",
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,ts}"],
    exclude: [
      "**/node_modules/**",
      "tests/**", // Playwright e2e テストを除外
      "**/.{cache,build,svelte-kit}/**",
    ],
    globals: true,
  },
});
