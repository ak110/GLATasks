/**
 * @fileoverview テスト用ユーザーの作成と認証状態の保存
 *
 * 開発用dev serverはHMRで頻繁に再読込される。ログインや登録のPOST後、
 * サーバー側ではセッションCookieの設定が完了していても、HMRの再ビルド
 * 待ちでリダイレクト先ページへの遷移だけが10秒前後遅延し、`waitForURL`
 * がタイムアウトするケースがある。このため、各フェーズは「認証ページへ
 * 再遷移したときに非auth URLへリダイレクトされるか」を主たる成功判定と
 * するリトライループで堅牢化している。`waitForURL`のタイムアウトを
 * 単純に延ばすだけでは、Cookie設定済みにもかかわらず失敗と誤判定する
 * ケース（例: 登録成功後のリダイレクト待ちタイムアウト時に再度/auth/loginへ
 * 遷移すると認証済みとして/へリダイレクトされ、ログインフォームへのfillが失敗する）
 * を救済できないため、この設計を維持する必要がある。
 */

import { chromium, type Page, type FullConfig } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { BASE_URL } from "./helpers/common";
const TEST_USER = "e2etest";
const TEST_PASSWORD = "e2etestpass123";
const MAX_ATTEMPTS = 3;
const RETRY_INTERVAL_MS = 1000;
const WAIT_TIMEOUT_MS = 30000;
const FORM_OP_TIMEOUT_MS = 5000;

/** /auth/ 以外のページに遷移するまで待機する */
async function waitForNonAuthUrl(
  page: Page,
  timeoutMs = WAIT_TIMEOUT_MS,
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

/** フォームの全フィールドに入力してsubmitボタンを押す。要素不在や未表示ならfalseを返す */
async function tryFillAndSubmit(
  page: Page,
  fields: readonly (readonly [selector: string, value: string])[],
): Promise<boolean> {
  try {
    for (const [selector, value] of fields) {
      await page.fill(selector, value, { timeout: FORM_OP_TIMEOUT_MS });
    }
    await page.click('button[type="submit"]', { timeout: FORM_OP_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/** 認証ページへ遷移し、非auth URLへリダイレクトされれば認証済みと判定する */
async function isAuthenticated(page: Page, authPath: string): Promise<boolean> {
  await page.goto(`${BASE_URL}${authPath}`);
  return !page.url().includes("/auth/");
}

async function globalSetup(_config: FullConfig) {
  const authDir = path.join(import.meta.dirname, ".auth");
  fs.mkdirSync(authDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // ログイン→登録の順で試行する。dev serverのHMR再読込でURL遷移待ちがタイムアウト
  // しても、Cookieが既に設定されているケースを救済するため、各試行の冒頭と
  // フォーム送信後の双方で「認証ページ遷移時の自動リダイレクト」により認証済み
  // 状態を判定する。
  let authenticated = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !authenticated; attempt++) {
    if (attempt > 0) {
      await page.waitForTimeout(RETRY_INTERVAL_MS);
    }

    if (await isAuthenticated(page, "/auth/login")) {
      authenticated = true;
      break;
    }
    if (
      await tryFillAndSubmit(page, [
        ['[name="user"]', TEST_USER],
        ['[name="password"]', TEST_PASSWORD],
      ])
    ) {
      if (await waitForNonAuthUrl(page)) {
        authenticated = true;
        break;
      }
    }

    if (await isAuthenticated(page, "/auth/regist_user")) {
      authenticated = true;
      break;
    }
    if (
      await tryFillAndSubmit(page, [
        ['[name="user_id"]', TEST_USER],
        ['[name="password"]', TEST_PASSWORD],
        ['[name="password_confirm"]', TEST_PASSWORD],
      ])
    ) {
      if (await waitForNonAuthUrl(page)) {
        authenticated = true;
        break;
      }
    }
  }

  // Cookie確立後に認証必須ページへ到達できることを最終確認する
  if (authenticated) {
    await page.goto(`${BASE_URL}/`);
    if (page.url().includes("/auth/")) {
      authenticated = false;
    }
  }

  if (!authenticated) {
    await browser.close();
    throw new Error(
      `E2E テスト用の認証に失敗しました: current URL = ${page.url()}`,
    );
  }

  await context.storageState({ path: path.join(authDir, "user.json") });
  await browser.close();
}

export default globalSetup;
