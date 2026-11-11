/**
 * @fileoverview 共有タスク追加ページのサーバーサイド処理
 */

import { fail, redirect } from "@sveltejs/kit";
import * as operations from "#lib/server/operations/index.ts";
import { getErrorStatus, getPublicError } from "#lib/server/api-errors.ts";
import { CreateTaskSchema } from "#lib/schemas.ts";
import { buildShareInitialText } from "#lib/server/share-ingest.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url, fetch }) => {
  if (!locals.user_id) redirect(302, "/auth/login");
  const [initialText, lists] = await Promise.all([
    // X投稿は投稿者名と本文（日本語訳）を外部サービスから補う。失敗しても共有元の内容で画面を開く。
    buildShareInitialText(
      {
        title: url.searchParams.get("title") ?? "",
        text: url.searchParams.get("text") ?? "",
        url: url.searchParams.get("url") ?? "",
      },
      {
        fetch,
        log: (message) => console.warn(`[share/ingest] ${message}`),
      },
    ),
    operations.lists.list({ userId: locals.user_id }, "active"),
  ]);
  return { initialText, lists };
};

export const actions: Actions = {
  default: async ({ request, locals, url }) => {
    const data = await request.formData();
    if (!locals.user_id) redirect(302, "/auth/login");
    const listId = Number(data.get("list_id"));
    const text = data.get("text");

    const parsed = CreateTaskSchema.safeParse({ listId, text });
    if (!parsed.success) {
      return fail(400, {
        error:
          "入力内容が不正です。共有するテキストを1文字以上入力し、追加先のリストを選んでください。",
      });
    }

    try {
      await operations.tasks.create(
        { userId: locals.user_id, tabId: null },
        parsed.data,
      );
    } catch (e) {
      return fail(getErrorStatus(e), { error: getPublicError(e).message });
    }

    // Chrome拡張のポップアップは本画面をiframeへ埋め込む。メイン画面は拡張からの埋め込みを許可しないため、
    // 転送するとブラウザーが表示を拒否する。ポップアップでは同じ画面で追加結果を表示する。
    if (url.searchParams.get("in_popup") === "1") {
      return { added: { listId } };
    }
    redirect(303, "/#" + listId);
  },
};
