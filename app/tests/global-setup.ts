/**
 * @fileoverview テスト用ユーザーの作成と認証状態の保存
 */

import { chromium, type FullConfig } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const BASE_URL = process.env.BASE_URL ?? "https://localhost:38180";
const TEST_USER = "e2etest";
const TEST_PASSWORD = "e2etestpass123";

/** /auth/ 以外のページに遷移するまで待機する */
async function waitForNonAuthUrl(
  page: import("@playwright/test").Page,
  timeoutMs = 8000,
): Promise<boolean> {
  try {
    await page.waitForURL((url) => !url.toString().includes("/auth/"), {
      timeout: timeoutMs,
    });
    return true;
  } catch {
    return false;
  }
}

async function globalSetup(_config: FullConfig) {
  const authDir = path.join(import.meta.dirname, ".auth");
  fs.mkdirSync(authDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // 既存ユーザーでログインを試みる。失敗した場合は新規登録する。
  await page.goto(`${BASE_URL}/auth/login`);
  await page.fill('[name="user"]', TEST_USER);
  await page.fill('[name="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');

  const loginOk = await waitForNonAuthUrl(page, 8000);

  if (!loginOk) {
    // ユーザー登録
    await page.goto(`${BASE_URL}/auth/regist_user`);
    await page.fill('[name="user_id"]', TEST_USER);
    await page.fill('[name="password"]', TEST_PASSWORD);
    await page.fill('[name="password_confirm"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    const registerOk = await waitForNonAuthUrl(page, 10000);
    if (!registerOk) {
      throw new Error(
        `テストユーザー登録に失敗しました: current URL = ${page.url()}`,
      );
    }
  }

  await context.storageState({ path: path.join(authDir, "user.json") });
  await browser.close();
}

export default globalSetup;
