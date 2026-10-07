/**
 * @fileoverview 共有タスク追加ページのサーバーサイド処理
 */

import { fail, redirect } from "@sveltejs/kit";
import * as operations from "#lib/server/operations/index.ts";
import { getErrorStatus, getPublicError } from "#lib/server/api-errors.ts";
import { CreateTaskSchema } from "#lib/schemas.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const title = url.searchParams.get("title") ?? "";
  const text = url.searchParams.get("text") ?? "";
  const pageUrl = url.searchParams.get("url") ?? "";
  if (!locals.user_id) redirect(302, "/auth/login");
  const lists = await operations.lists.list(
    { userId: locals.user_id },
    "active",
  );
  return { title, text, pageUrl, lists };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const data = await request.formData();
    if (!locals.user_id) redirect(302, "/auth/login");
    const listId = Number(data.get("list_id"));
    const text = data.get("text");

    const parsed = CreateTaskSchema.safeParse({ listId, text });
    if (!parsed.success) {
      return fail(400, { error: "入力内容が不正です。" });
    }

    try {
      await operations.tasks.create(
        { userId: locals.user_id, tabId: null },
        parsed.data,
      );
    } catch (e) {
      return fail(getErrorStatus(e), { error: getPublicError(e).message });
    }

    redirect(303, "/#" + listId);
  },
};
