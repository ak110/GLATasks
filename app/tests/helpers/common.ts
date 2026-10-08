import {
  expect,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
/**
 * @fileoverview e2eテスト共通ヘルパー
 *
 * BASE_URL・storageStateパス・リスト準備/後片付け処理を一元管理する。
 * 各テストファイルで重複していた定義をここに集約し、
 * 不統一なパス形式（絶対パスと相対パスの混在）を解消する。
 */

import * as path from "node:path";

/** テスト対象のベースURL */
export const BASE_URL = process.env.BASE_URL ?? "https://localhost:38180";

/**
 * 認証状態ファイルのパス
 *
 * `import.meta.dirname` 基準の絶対パスで統一し、実行ディレクトリに依存しない形にする。
 * playwright.config.ts の storageState 設定はリポジトリルート基準の相対パスを使うが、
 * テストコード内では絶対パスを使うことで一貫性を保つ。
 */
export const STORAGE_STATE_PATH = process.env.E2E_STORAGE_STATE
  ? path.resolve(import.meta.dirname, "../../..", process.env.E2E_STORAGE_STATE)
  : path.join(import.meta.dirname, "..", ".auth", "user.json");

/** 指定したprocedureを含むtRPC応答かどうかを判定する */
export function isMutationResponse(
  response: Response,
  procedure: string,
): boolean {
  return isTrpcUrl(response.url(), procedure);
}

export function isTrpcUrl(url: string, procedure: string): boolean {
  const pathname = new URL(url).pathname;
  const prefix = "/api/trpc/";
  if (!pathname.startsWith(prefix)) return false;
  return pathname.slice(prefix.length).split(",").includes(procedure);
}

/** 操作前に登録した指定procedureのmutation応答を待つ */
export function waitForMutationResponse(
  page: Page,
  procedure: string,
): Promise<Response> {
  return page.waitForResponse((response) =>
    isMutationResponse(response, procedure),
  );
}

/** 指定procedureのmutationがHTTP成功で完了するまで待つ */
export async function waitForSuccessfulMutationResponse(
  page: Page,
  procedure: string,
): Promise<Response> {
  const response = await waitForMutationResponse(page, procedure);
  if (!response.ok()) {
    throw new Error(`${procedure}がHTTP ${response.status()}で失敗した`);
  }
  return response;
}

/** タスク更新mutationの応答を待つ */
export function waitForTaskUpdateResponse(page: Page): Promise<Response> {
  return waitForMutationResponse(page, "tasks.update");
}

/** 楽観追加されたタスクが実IDへ置き換わるまで待つ */
export async function waitForPersistedTask(taskRow: Locator): Promise<void> {
  await expect
    .poll(async () => Number(await taskRow.getAttribute("data-reorder-id")))
    .toBeGreaterThan(0);
}

/** タスク状態を1段階進め、成功応答と画面状態の反映後に返る */
export async function toggleTaskAndWaitForUpdate(
  page: Page,
  checkbox: Locator,
): Promise<void> {
  const taskRow = checkbox.locator("..");
  await waitForPersistedTask(taskRow);

  const wasChecked = await checkbox.isChecked();
  const wasRunning = await checkbox.evaluate(
    (element: HTMLInputElement) => element.indeterminate,
  );
  const wasArchived = await taskRow.evaluate((element) =>
    element.classList.contains("opacity-50"),
  );
  const responsePromise = waitForSuccessfulMutationResponse(
    page,
    "tasks.update",
  );
  await checkbox.dispatchEvent("click");
  await responsePromise;

  const taskText = taskRow.getByTestId("task-text");
  if (wasChecked) {
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toHaveJSProperty("indeterminate", false);
    await expect(taskText).not.toHaveClass(/line-through/);
  } else if (wasRunning || wasArchived) {
    await expect(checkbox).toBeChecked();
    await expect(taskText).toHaveClass(/line-through/);
  } else {
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toHaveJSProperty("indeterminate", true);
    await expect(taskText).not.toHaveClass(/line-through/);
  }
}

/** テスト用リストを作成するための共通コンテキストオプション */
export function makeContextOptions(
  overrides: BrowserContextOptions = {},
): BrowserContextOptions {
  return {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE_PATH,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    ...overrides,
  };
}

/** 並行するテストと衝突しない名前を生成する */
export function uniqueTestName(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

export async function requireBoundingBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("要素の境界ボックスを取得できません");
  return box;
}

/** 公開UIでリストを追加し、必要に応じて選択する */
export async function createListFromPage(
  page: Page,
  listName: string,
  select = true,
): Promise<void> {
  await page.getByPlaceholder("新しいリスト", { exact: true }).fill(listName);
  const response = waitForSuccessfulMutationResponse(page, "lists.create");
  await page.locator('aside button[type="submit"]').click();
  await response;
  const button = page
    .getByTestId("list-select-btn")
    .filter({ hasText: listName });
  await expect(button).toBeVisible({ timeout: 15_000 });
  if (select) {
    await button.click();
    await expect(
      page.getByRole("heading", { name: listName, exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("task-add-form")).toBeVisible();
  }
}

/** 入力内容を追加し、実IDと追加欄の復元を待つ */
export async function addTask(
  page: Page,
  text: string,
  options: { todo?: boolean; openEdit?: boolean } = {},
): Promise<Locator> {
  const form = page.getByTestId("task-add-form");
  await form.locator("textarea").click();
  await form.locator("textarea").fill(text);
  if (options.todo !== undefined) {
    await form.getByTestId("task-add-todo-checkbox").setChecked(options.todo);
  }
  const response = waitForSuccessfulMutationResponse(page, "tasks.create");
  await form.locator('button[type="submit"]').click();
  await response;
  const taskRow = page
    .getByTestId("task-item")
    .filter({ hasText: text.split("\n")[0] });
  await expect(taskRow).toBeVisible({ timeout: 15_000 });
  await waitForPersistedTask(taskRow);
  await expect(form.locator("textarea")).toHaveValue("");
  if (options.openEdit) {
    await taskRow.getByTestId("task-edit-btn").dispatchEvent("click");
    await expect(
      page.getByRole("dialog").last().locator('input[type="file"]'),
    ).toBeVisible();
  }
  return taskRow;
}

type FixtureOperation =
  | { kind: "create"; listNames: readonly string[] }
  | { kind: "delete"; listNames: readonly string[] };

async function deleteTestListFromPage(
  page: Page,
  listName: string,
): Promise<void> {
  const listRow = page.getByTestId("list-item").filter({ hasText: listName });
  // 一覧の取得応答の後も行の描画は遅れて届く。描画前に数えると対象が無いと判定して削除を省くため、
  // 一覧行の表示を待ってから対象の有無を判定する
  await expect(page.getByTestId("list-item").first()).toBeVisible();
  if ((await listRow.count()) === 0) return;
  await listRow.getByTestId("list-menu-btn").click();
  await page.getByTestId("list-delete-btn").click();
  const responsePromise = waitForSuccessfulMutationResponse(
    page,
    "lists.delete",
  );
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "削除", exact: true })
    .click();
  await responsePromise;
  await expect(listRow).toHaveCount(0);
}

/**
 * 公開UIを操作してテスト用リストを作成・削除する
 *
 * 開発サーバーとビルド済み環境の双方で成立する経路へ統一するため、
 * Viteのソースモジュール（`/src/lib/trpc.ts`）へは依存しない。
 */
async function mutateTestListFixtures(
  page: Page,
  operation: FixtureOperation,
): Promise<void> {
  await Promise.all([
    page.goto("/"),
    page.waitForResponse((response) => response.url().includes("/api/trpc")),
  ]);

  if (operation.kind === "create") {
    for (const listName of operation.listNames) {
      await createListFromPage(page, listName, false);
    }
  } else {
    const errors: unknown[] = [];
    for (const listName of operation.listNames) {
      try {
        await deleteTestListFromPage(page, listName);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "テスト用リストの削除に失敗した");
    }
  }

  await page.goto("about:blank");
}

/**
 * テスト用リストを作成する
 *
 * `beforeAll` から呼び出す。作成後にコンテキストをクローズする。
 */
export async function setupTestList(
  browser: Browser,
  listName: string,
): Promise<void> {
  await setupTestLists(browser, [listName]);
}

/** 1つのコンテキストで複数のテスト用リストを作成する */
export async function setupTestLists(
  browser: Browser,
  listNames: readonly string[],
): Promise<void> {
  if (listNames.length === 0) return;
  const ctx = await browser.newContext(makeContextOptions());
  const attemptedListNames: string[] = [];
  try {
    const page = await ctx.newPage();
    attemptedListNames.push(...listNames);
    await mutateTestListFixtures(page, { kind: "create", listNames });
  } catch (setupError) {
    try {
      const page = ctx.pages()[0];
      if (page) {
        await mutateTestListFixtures(page, {
          kind: "delete",
          listNames: attemptedListNames,
        });
      }
    } catch (cleanupError) {
      throw new AggregateError(
        [setupError, cleanupError],
        "テスト用リストの作成と途中作成分の削除に失敗した",
        { cause: cleanupError },
      );
    }
    throw setupError;
  } finally {
    await ctx.close();
  }
}

/**
 * テスト用リストを削除する
 *
 * `afterAll` から呼び出す。削除後にコンテキストをクローズする。
 */
export async function cleanupTestList(
  browser: Browser,
  listName: string,
): Promise<void> {
  await cleanupTestLists(browser, [listName]);
}

/** 1つのコンテキストで複数のテスト用リストを削除する */
export async function cleanupTestLists(
  browser: Browser,
  listNames: readonly string[],
): Promise<void> {
  if (listNames.length === 0) return;
  const ctx = await browser.newContext(makeContextOptions());
  try {
    const page = await ctx.newPage();
    await mutateTestListFixtures(page, { kind: "delete", listNames });
  } finally {
    await ctx.close();
  }
}
