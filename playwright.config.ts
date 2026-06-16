import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./app/tests",
  testIgnore: /global-setup\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  globalSetup: "./app/tests/global-setup.ts",
  use: {
    baseURL: process.env.BASE_URL ?? "https://localhost:38180",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // タッチ専用テスト（*.mobile.test.ts）はモバイルプロジェクトでのみ動かす
      testIgnore: /\.mobile\.test\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "app/tests/.auth/user.json",
      },
    },
    {
      name: "mobile-chrome",
      // モバイルブレークポイントの回帰検知用に viewport だけを Pixel 5 サイズへ
      // 縮小した Desktop Chrome を使う。
      // 完全な mobile emulation（`devices["Pixel 5"]`）下では Playwright の
      // mouse 入力で setPointerCapture を伴う Pointer Events の自動駆動が
      // 安定しないため、入力経路は Desktop と同じものにそろえる。
      // 実タッチ入力での動作確認は Chrome DevTools のデバイスエミュレーション
      // 等で手動検証する想定。
      testMatch: /\.mobile\.test\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 393, height: 851 },
        storageState: "app/tests/.auth/user.json",
      },
    },
  ],
});
