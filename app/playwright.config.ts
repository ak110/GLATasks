import { defineConfig, devices } from "@playwright/test";
import * as path from "node:path";

const storageState = path.resolve(
  import.meta.dirname,
  "..",
  process.env.E2E_STORAGE_STATE || "app/tests/.auth/user.json",
);

const shard = process.env.E2E_SHARD;
if (shard !== undefined && shard !== "" && shard !== "1/2" && shard !== "2/2") {
  throw new Error(
    `不明な E2E_SHARD: ${JSON.stringify(shard)}。1/2 または 2/2 を指定してください。未指定の場合は全件を実行します。`,
  );
}

const longFiles =
  /[/\\](?:offline|page-scroll|query-error-notifications|search|task-scroll|translate)\.test\.ts$/;
const shardIgnore =
  shard === "1/2"
    ? [new RegExp(`^(?!.*${longFiles.source})`)]
    : shard === "2/2"
      ? [longFiles]
      : [];

export default defineConfig({
  testDir: "./tests",
  outputDir: path.resolve(
    import.meta.dirname,
    "..",
    process.env.E2E_OUTPUT_DIR || "test-results",
  ),
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  globalSetup: "./tests/global-setup.ts",
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
      testIgnore: [/\.mobile\.test\.ts$/, ...shardIgnore],
      use: {
        ...devices["Desktop Chrome"],
        storageState,
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
      testIgnore: shardIgnore,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 393, height: 851 },
        storageState,
      },
    },
  ],
});
