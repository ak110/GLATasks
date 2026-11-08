import { uniqueTestName } from "./helpers/common";
import { test, expect } from "@playwright/test";
/**
 * @fileoverview 新しい版の検知後の自動再読み込みのe2eテスト
 *
 * 作業中でない画面では、新しい版を検知すると更新案内の再読み込みボタンを押さずに再読み込みされることを確かめる。
 * 作業中は再読み込みせず更新案内を表示し続けることは`page-scroll.test.ts`の同時バナーの試験が確かめる。
 */

test("作業中でなければ、新しい版の検知で自動的に再読み込みする", async ({
  page,
}) => {
  // 更新案内は、データ応答の`x-sveltekit-version`が読み込み時の版と異なると表示される。
  // `version.json`の定期確認は開発サーバーで行われないため、両方の環境で働くデータ応答を使う。
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

  await Promise.all([
    page.goto("/"),
    page.waitForResponse((res) => res.url().includes("/api/trpc")),
  ]);
  // 再読み込みで消える印を置き、再読み込みが起きたことを確かめる
  const marker = `update-marker-${uniqueTestName("e2e")}`;
  await page.evaluate((value) => {
    (window as typeof window & { __updateMarker?: string }).__updateMarker =
      value;
  }, marker);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName))
    .not.toMatch(/^(INPUT|TEXTAREA|SELECT)$/);

  // 別の画面へのリンクのhoverによる先読みは遷移を伴わずにデータ応答を受け取るため、これで新しい版を検知させる。
  reportNewVersion = true;
  const reloaded = page.waitForEvent("load");
  await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/__data.json") &&
        response.headers()["x-sveltekit-version"] === newVersion,
    ),
    page.getByTestId("header-nav-timers").hover(),
  ]);
  // 再読み込み後のデータ応答で再び新しい版を検知しないよう、実際の版へ戻す
  reportNewVersion = false;
  await reloaded;

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __updateMarker?: string })
            .__updateMarker,
      ),
    )
    .toBeUndefined();
  await expect(page.getByTestId("update-banner")).toHaveCount(0);
});
