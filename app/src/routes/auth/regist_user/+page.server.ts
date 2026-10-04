/**
 * @fileoverview ユーザー登録ページのサーバーサイド処理
 */

import { fail, redirect } from "@sveltejs/kit";
import * as api from "#lib/server/api.ts";
import { createSessionToken, setSessionCookie } from "#lib/server/session.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user_id) {
    redirect(302, "/");
  }
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const data = await request.formData();
    const userId = data.get("user_id") as string;
    const password = data.get("password") as string;
    const passwordConfirm = data.get("password_confirm") as string;

    if (!userId || !password) {
      return fail(400, { error: "ユーザーIDとパスワードを入力してください。" });
    }
    if (password !== passwordConfirm) {
      return fail(400, { error: "パスワードが一致しません。" });
    }

    try {
      const userInfo = await api.registerUser(userId, password);
      const token = await createSessionToken(userInfo.id);
      setSessionCookie(cookies, token);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "ユーザー登録に失敗しました。";
      return fail(400, { error: msg });
    }

    redirect(302, "/");
  },
};
