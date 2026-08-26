/**
 * @fileoverview e2eテスト共通ヘルパー
 *
 * BASE_URL・storageStateパス・リスト準備/後片付け処理を一元管理する。
 * 各テストファイルで重複していた定義をここに集約し、
 * 不統一なパス形式（絶対パスと相対パスの混在）を解消する。
 */

import {
  expect,
  type Browser,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
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
  ? path.resolve(process.env.E2E_STORAGE_STATE)
  : path.join(import.meta.dirname, "..", ".auth", "user.json");

/** 指定したprocedureを含むtRPC応答かどうかを判定する */
export function isMutationResponse(
  response: Response,
  procedure: string,
): boolean {
  const pathname = new URL(response.url()).pathname;
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
function makeContextOptions() {
  return {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE_PATH,
    ignoreHTTPSErrors: true,
  };
}

type FixtureList = { id: number; title: string };

type FixtureTrpcClient = {
  lists: {
    create: { mutate: (input: { title: string }) => Promise<unknown> };
    list: { query: (showType: "all") => Promise<unknown> };
    delete: { mutate: (input: { listId: number }) => Promise<unknown> };
  };
};

type FixtureOperation =
  | { kind: "create"; listNames: readonly string[] }
  | { kind: "delete"; listNames: readonly string[] };

/** 軽量ページで初期化済みの暗号化tRPCクライアントを使ってfixtureを操作する */
async function mutateTestListFixtures(
  page: Page,
  operation: FixtureOperation,
): Promise<void> {
  const mounted = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/events",
  );
  await page.goto("/translate");
  await mounted;
  await page.evaluate(
    async ({ moduleUrl, operation }) => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const module = (await import(
        /* @vite-ignore */ moduleUrl
      )) as unknown as { trpc: FixtureTrpcClient };
      const { trpc } = module;

      if (operation.kind === "create") {
        await Promise.all(
          operation.listNames.map((title) =>
            trpc.lists.create.mutate({ title }),
          ),
        );
        return;
      }

      const rawLists = await trpc.lists.list.query("all");
      if (!Array.isArray(rawLists)) {
        throw new Error("テスト用リスト一覧が配列ではありません");
      }
      const targetNames = new Set(operation.listNames);
      const targetLists: FixtureList[] = rawLists.map((list) => {
        if (
          typeof list !== "object" ||
          list === null ||
          !("id" in list) ||
          typeof list.id !== "number" ||
          !("title" in list) ||
          typeof list.title !== "string"
        ) {
          throw new Error("テスト用リスト一覧の項目が不正です");
        }
        return { id: list.id, title: list.title };
      });
      await Promise.all(
        targetLists
          .filter((list) => targetNames.has(list.title))
          .map((list) => trpc.lists.delete.mutate({ listId: list.id })),
      );
    },
    { moduleUrl: "/src/lib/trpc.ts", operation },
  );
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
