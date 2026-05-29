/**
 * @fileoverview 共有タスク追加ページのサーバーサイド処理
 */

import { fail, redirect } from "@sveltejs/kit";
import * as api from "$lib/server/api";
import { sendEvent } from "$lib/server/sse";
import { SSE_EVENTS } from "$lib/sse-events";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const title = url.searchParams.get("title") ?? "";
  const text = url.searchParams.get("text") ?? "";
  const pageUrl = url.searchParams.get("url") ?? "";
  const lists = await api.getLists(locals.user_id!, "active");
  return { title, text, pageUrl, lists };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const data = await request.formData();
    const listId = Number(data.get("list_id"));
    const text = data.get("text");

    if (!listId || typeof text !== "string" || !text) {
      return fail(400, { error: "入力内容が不正です。" });
    }

    try {
      await api.postTask(locals.user_id!, listId, text);
      // 共有追加はtRPCルーターを経由しないため、通常のタスク追加と異なり
      // 更新通知が自動送出されない。他ウィンドウ・他端末へ反映させるため、
      // DB書き込み成功後に明示的に通知を送る。送出元タブIDはフォーム経路では
      // 取得できないため未指定とし、受信側では他端末発として差分反映される。
      sendEvent(locals.user_id!, SSE_EVENTS.tasksUpdated);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "タスクの追加に失敗しました。";
      return fail(500, { error: msg });
    }

    redirect(303, "/#" + listId);
  },
};
