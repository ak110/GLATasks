import { test, expect, type Page, type Request } from "@playwright/test";
import { createConnection } from "mysql2/promise";
import {
  addTask,
  cleanupTestLists,
  isTrpcUrl,
  makeContextOptions,
  setupTestLists,
  uniqueTestName,
  waitForSuccessfulMutationResponse,
} from "./helpers/common";

/** リスト通知と、切断中に取りこぼした古いタスクの復旧を検証する。 */

function listRow(page: Page, name: string) {
  return page.getByTestId("list-item").filter({ hasText: name });
}

async function openPage(page: Page) {
  await Promise.all([
    page.goto("/"),
    page.waitForResponse((response) =>
      isTrpcUrl(response.url(), "tasks.listActive"),
    ),
  ]);
}

async function selectList(page: Page, name: string) {
  await listRow(page, name).getByTestId("list-select-btn").click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByTestId("task-add-form")).toBeVisible();
}

/** menuBehaviorが付与するmenuitemに合わせ、ダイアログのbuttonと区別する。 */
async function renameList(page: Page, name: string, renamed: string) {
  await listRow(page, name).getByTestId("list-menu-btn").click();
  await page.getByRole("menuitem", { name: "名前変更", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.locator('input[type="text"]').fill(renamed);
  const response = waitForSuccessfulMutationResponse(page, "lists.rename");
  await dialog.getByRole("button", { name: "変更", exact: true }).click();
  await response;
  await expect(listRow(page, renamed)).toBeVisible();
}

async function archiveList(page: Page, name: string) {
  await listRow(page, name).getByTestId("list-menu-btn").click();
  await page.getByRole("menuitem", { name: "アーカイブ", exact: true }).click();
  const response = waitForSuccessfulMutationResponse(page, "lists.archive");
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "アーカイブ", exact: true })
    .click();
  await response;
  await expect(listRow(page, name)).toHaveCount(0);
}

async function unarchiveList(page: Page, name: string) {
  await page.locator("header select").selectOption("all");
  await listRow(page, name).getByTestId("list-menu-btn").click();
  const response = waitForSuccessfulMutationResponse(page, "lists.unarchive");
  await page
    .getByRole("menuitem", { name: "アーカイブ解除", exact: true })
    .click();
  await response;
  await page.locator("header select").selectOption("active");
  await expect(listRow(page, name)).toBeVisible();
}

async function mergeList(page: Page, source: string, target: string) {
  await listRow(page, source).getByTestId("list-menu-btn").click();
  await page
    .getByRole("menuitem", { name: "他のリストに統合", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "リストの統合" });
  await dialog.getByLabel("統合先リスト").selectOption({ label: target });
  const response = waitForSuccessfulMutationResponse(page, "lists.merge");
  await dialog.getByRole("button", { name: "統合", exact: true }).click();
  await response;
  await expect(listRow(page, source)).toHaveCount(0);
}

async function deleteList(page: Page, name: string) {
  await listRow(page, name).getByTestId("list-menu-btn").click();
  await page.getByTestId("list-delete-btn").click();
  const response = waitForSuccessfulMutationResponse(page, "lists.delete");
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "削除", exact: true })
    .click();
  await response;
  await expect(listRow(page, name)).toHaveCount(0);
}

/** 途中失敗でアーカイブが残った場合も共通cleanupから削除できるように戻す。 */
async function restoreArchivedLists(page: Page, names: readonly string[]) {
  if (page.url() === "about:blank") return;
  await page.locator("header select").selectOption("all");
  for (const name of names) {
    const row = listRow(page, name);
    if ((await row.count()) === 0) continue;
    await row.getByTestId("list-menu-btn").click();
    const button = row.getByRole("menuitem", {
      name: "アーカイブ解除",
      exact: true,
    });
    if ((await button.count()) > 0) {
      const response = waitForSuccessfulMutationResponse(
        page,
        "lists.unarchive",
      );
      await button.click();
      await response;
    } else {
      await row.getByTestId("list-menu-btn").click();
    }
  }
}

/** 他手続きの入力で誤判定しないよう、バッチ内のlistActiveの位置だけを確認する。 */
function activeTasksInput(request: Request): Record<string, unknown> | null {
  if (!isTrpcUrl(request.url(), "tasks.listActive")) return null;
  const url = new URL(request.url());
  const procedures = url.pathname.slice("/api/trpc/".length).split(",");
  const raw = url.searchParams.get("input") ?? request.postData();
  if (!raw) throw new Error("tasks.listActive の入力がありません");
  const payload = JSON.parse(raw) as Record<string, Record<string, unknown>>;
  const input =
    url.searchParams.get("batch") === "1"
      ? payload[String(procedures.indexOf("tasks.listActive"))]
      : payload;
  if (!input || typeof input !== "object") {
    throw new Error("tasks.listActive の該当入力を取得できません");
  }
  return input;
}

async function taskIds(page: Page): Promise<number[]> {
  return page
    .getByTestId("task-item")
    .evaluateAll((rows) =>
      rows
        .map((row) => Number(row.getAttribute("data-reorder-id")))
        .sort((left, right) => left - right),
    );
}

test("別タブのリスト名前変更・アーカイブ・削除が検索語を変えず検索結果へ反映される", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const stamp = uniqueTestName("検索リスト同期");
  const source = "検索変更元_" + stamp;
  const renamed = "検索変更後_" + stamp;
  const target = "検索保持_" + stamp;
  const keyword = "固定検索語_" + stamp;
  const sourceTitle = keyword + "_変更対象";
  const targetTitle = keyword + "_保持対象";
  const names = [source, renamed, target];
  const contextA = await browser.newContext(makeContextOptions());
  const contextB = await browser.newContext(makeContextOptions());
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await setupTestLists(browser, [source, target]);
    await openPage(pageB);
    await selectList(pageB, source);
    await addTask(pageB, sourceTitle);
    await selectList(pageB, target);
    await addTask(pageB, targetTitle);
    await openPage(pageA);
    await selectList(pageA, target);
    const input = pageA.getByTestId("search-input");
    await input.fill(keyword);
    const result = (title: string) =>
      pageA.locator("main").getByRole("button", { name: title, exact: true });
    await expect(result(sourceTitle)).toBeVisible({ timeout: 15_000 });
    await expect(result(targetTitle)).toBeVisible();

    await renameList(pageB, source, renamed);
    await expect(result(renamed)).toBeVisible({ timeout: 15_000 });
    await expect(result(source)).toHaveCount(0);
    await expect(input).toHaveValue(keyword);
    await expect(result(sourceTitle)).toBeVisible();

    await archiveList(pageB, renamed);
    await expect(result(sourceTitle)).toHaveCount(0, { timeout: 15_000 });
    await expect(result(renamed)).toHaveCount(0);
    await expect(result(targetTitle)).toBeVisible();
    await expect(input).toHaveValue(keyword);

    // 全件表示でも同じ検索語を保持し、削除の通知を独立して検証する。
    await pageA.locator("header select").selectOption("all");
    await expect(result(sourceTitle)).toBeVisible({ timeout: 15_000 });
    await pageB.locator("header select").selectOption("all");
    await deleteList(pageB, renamed);
    await expect(result(sourceTitle)).toHaveCount(0, { timeout: 15_000 });
    await expect(result(renamed)).toHaveCount(0);
    await expect(result(targetTitle)).toBeVisible();
    await expect(input).toHaveValue(keyword);
  } finally {
    try {
      await restoreArchivedLists(pageB, names);
    } finally {
      await Promise.all([contextA.close(), contextB.close()]);
      await cleanupTestLists(browser, names);
    }
  }
});

for (const event of ["connected", "reset"] as const) {
  for (const operation of ["unarchive", "merge", "delete"] as const) {
    test(
      "SSE遮断中の古いタスクのリスト" +
        operation +
        "が" +
        event +
        "受信でsinceなし全件取得へ復旧する",
      async ({ browser }) => {
        test.setTimeout(60_000);
        const stamp = uniqueTestName("全件復旧");
        const source = "復旧元_" + stamp;
        const target = "復旧先_" + stamp;
        const names = [source, target];
        const contextA = await browser.newContext(makeContextOptions());
        const contextB = await browser.newContext(makeContextOptions());
        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();
        // 実EventSourceを保持し、connectedとresetの受入を別々に検証する。
        // 接続をcloseした後、指定イベントだけを同じインスタンスへ配送する。
        await pageA.addInitScript(() => {
          const NativeEventSource = window.EventSource;
          window.EventSource = class extends NativeEventSource {
            constructor(url: string | URL, options?: EventSourceInit) {
              super(url, options);
              (
                window as Window & { acceptanceSource?: EventSource }
              ).acceptanceSource = this;
            }
          };
        });
        try {
          await setupTestLists(browser, names);
          await openPage(pageB);
          const sourceIds: number[] = [];
          await selectList(pageB, source);
          for (const suffix of ["_1", "_2"]) {
            const row = await addTask(pageB, stamp + suffix);
            sourceIds.push(Number(await row.getAttribute("data-reorder-id")));
          }
          await selectList(pageB, target);
          const targetRow = await addTask(pageB, stamp + "_保持");
          const targetId = Number(
            await targetRow.getAttribute("data-reorder-id"),
          );
          const databaseUrl = process.env.DATABASE_URL;
          if (!databaseUrl) throw new Error("DATABASE_URL が必要です");
          const db = await createConnection(databaseUrl);
          try {
            // sinceより十分古くし、updatedによる差分で偶然復旧するのを防ぐ。
            await db.execute(
              "UPDATE task SET updated = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR) WHERE id IN (?, ?, ?)",
              [...sourceIds, targetId],
            );
          } finally {
            await db.end();
          }
          if (operation === "unarchive") await archiveList(pageB, source);
          await openPage(pageA);
          if (operation !== "unarchive") {
            await selectList(pageA, source);
            await expect
              .poll(() => taskIds(pageA))
              .toEqual(sourceIds.sort((a, b) => a - b));
          } else {
            await expect(listRow(pageA, source)).toHaveCount(0);
          }
          await selectList(pageA, target);
          await expect.poll(() => taskIds(pageA)).toEqual([targetId]);
          // APIは通したまま、SSE実接続と後続の再接続を遮断する。
          await contextA.route("**/api/events**", (route) => route.abort());
          await pageA.evaluate(() => {
            const source = (
              window as Window & { acceptanceSource?: EventSource }
            ).acceptanceSource;
            if (!source) throw new Error("SSEの実接続を取得できません");
            source.close();
          });

          if (operation === "unarchive") await unarchiveList(pageB, source);
          else if (operation === "merge")
            await mergeList(pageB, source, target);
          else await deleteList(pageB, source);
          // 復旧イベントより前はAの既存キャッシュが残っていることを確かめる。
          await expect.poll(() => taskIds(pageA)).toEqual([targetId]);
          await expect(listRow(pageA, source)).toHaveCount(
            operation === "unarchive" ? 0 : 1,
          );

          const inputs: Record<string, unknown>[] = [];
          pageA.on("request", (request) => {
            const input = activeTasksInput(request);
            if (input) inputs.push(input);
          });
          const response = waitForSuccessfulMutationResponse(
            pageA,
            "tasks.listActive",
          );
          await pageA.evaluate((eventName) => {
            const source = (
              window as Window & { acceptanceSource?: EventSource }
            ).acceptanceSource;
            if (!source) throw new Error("SSEの実接続を取得できません");
            source.dispatchEvent(
              new MessageEvent(eventName, {
                data: eventName === "connected" ? String(Date.now()) : "",
              }),
            );
          }, event);
          await response;
          expect(inputs.length).toBeGreaterThan(0);
          for (const input of inputs) expect(input).not.toHaveProperty("since");

          if (operation === "unarchive") {
            await expect(listRow(pageA, source)).toBeVisible({
              timeout: 15_000,
            });
            await selectList(pageA, source);
            await expect.poll(() => taskIds(pageA)).toEqual(sourceIds);
            await selectList(pageA, target);
            await expect.poll(() => taskIds(pageA)).toEqual([targetId]);
          } else {
            await expect(listRow(pageA, source)).toHaveCount(0, {
              timeout: 15_000,
            });
            const expected =
              operation === "merge"
                ? [...sourceIds, targetId].sort((a, b) => a - b)
                : [targetId];
            await expect.poll(() => taskIds(pageA)).toEqual(expected);
          }
        } finally {
          try {
            await restoreArchivedLists(pageB, names);
          } finally {
            await Promise.all([contextA.close(), contextB.close()]);
            await cleanupTestLists(browser, names);
          }
        }
      },
    );
  }
}
