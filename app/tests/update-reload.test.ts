import { uniqueTestName } from "./helpers/common";
import { test, expect, type Page } from "@playwright/test";
/**
 * @fileoverview 新しい版の検知後の自動再読み込みのe2eテスト
 *
 * 作業中でない画面では、新しい版を検知すると更新案内の再読み込みボタンを押さずに再読み込みされることを確かめる。
 * タスク追加フォームに未保存の入力が残る間は、フォーカスが外れていても再読み込みしないことも確かめる。
 * 入力欄へのフォーカス中とダイアログ表示中の見送りは`page-scroll.test.ts`の同時バナーの試験が確かめる。
 */

// 自動再読み込みが見送った後に条件を確かめ直す間隔（`update-reload.ts`のUPDATE_RELOAD_RETRY_INTERVAL_MS）
const RETRY_INTERVAL_MS = 3_000;

/**
 * データ応答の版を差し替えて、新しい版を検知させる準備をする。
 *
 * 更新案内は、データ応答の`x-sveltekit-version`が読み込み時の版と異なると表示される。
 * `version.json`の定期確認は開発サーバーで行われないため、両方の環境で働くデータ応答を使う。
 */
async function routeNewVersion(page: Page) {
  const newVersion = "e2e-auto-reload-new-version";
  let reportNewVersion = false;
  await page.route("**/__data.json*", async (route) => {
    if (!reportNewVersion) return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "x-sveltekit-version": newVersion },
    });
  });
  return {
    /** 別の画面へのリンクのhoverによる先読みは遷移を伴わずにデータ応答を受け取るため、これで新しい版を検知させる */
    async detect() {
      reportNewVersion = true;
      await Promise.all([
        page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname.endsWith("/__data.json") &&
            response.headers()["x-sveltekit-version"] === newVersion,
        ),
        page.getByTestId("header-nav-timers").hover(),
      ]);
    },
    /** 再読み込み後のデータ応答で再び新しい版を検知しないよう、実際の版へ戻す */
    reset() {
      reportNewVersion = false;
    },
  };
}

/** 再読み込みで消える印を置く */
async function placeReloadMarker(page: Page) {
  const marker = `update-marker-${uniqueTestName("e2e")}`;
  await page.evaluate((value) => {
    (window as typeof window & { __updateMarker?: string }).__updateMarker =
      value;
  }, marker);
  return marker;
}

function readReloadMarker(page: Page) {
  return page.evaluate(
    () =>
      (window as typeof window & { __updateMarker?: string }).__updateMarker,
  );
}

async function openTasks(page: Page) {
  await Promise.all([
    page.goto("/"),
    page.waitForResponse((res) => res.url().includes("/api/trpc")),
  ]);
}

test("作業中でなければ、新しい版の検知で自動的に再読み込みする", async ({
  page,
}) => {
  const version = await routeNewVersion(page);
  await openTasks(page);
  // 再読み込みで消える印を置き、再読み込みが起きたことを確かめる
  await placeReloadMarker(page);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName))
    .not.toMatch(/^(INPUT|TEXTAREA|SELECT)$/);

  const reloaded = page.waitForEvent("load");
  await version.detect();
  version.reset();
  await reloaded;

  await expect.poll(() => readReloadMarker(page)).toBeUndefined();
  await expect(page.getByTestId("update-banner")).toHaveCount(0);
});

test("タスク追加フォームに未保存の入力が残る間は、フォーカスが外れても再読み込みせず、入力を消すと再読み込みする", async ({
  page,
}) => {
  // 試し直しの間隔を固定時間の待機なしで経過させるため、ページの時計を差し替える
  await page.clock.install();
  const version = await routeNewVersion(page);
  await openTasks(page);
  const marker = await placeReloadMarker(page);

  const textarea = page.getByTestId("task-add-form").locator("textarea");
  const draft = `未保存の入力 ${uniqueTestName("e2e")}`;
  await textarea.fill(draft);
  // 入力欄からフォーカスを外し、フォーカスでは作業中と判定できない状態にする
  await textarea.blur();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName))
    .not.toMatch(/^(INPUT|TEXTAREA|SELECT)$/);

  await version.detect();
  await expect(page.getByTestId("update-banner")).toBeVisible();
  // 見送り後の試し直しを2回以上経ても再読み込みせず、入力が残る
  await page.clock.runFor(RETRY_INTERVAL_MS * 2 + 1_000);
  expect(await readReloadMarker(page)).toBe(marker);
  await expect(textarea).toHaveValue(draft);

  // 入力を消すと未保存の入力がなくなり、次の試し直しで再読み込みする
  await textarea.fill("");
  await textarea.blur();
  version.reset();
  const reloaded = page.waitForEvent("load");
  await page.clock.runFor(RETRY_INTERVAL_MS);
  await reloaded;
  await expect.poll(() => readReloadMarker(page)).toBeUndefined();
});
