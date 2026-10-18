/**
 * @fileoverview ユーザー登録ページのサーバーサイド処理
 */

import { fail, redirect } from "@sveltejs/kit";
import * as api from "#lib/server/api.ts";
import { createSessionToken, setSessionCookie } from "#lib/server/session.ts";
import { RegisterUserSchema } from "#lib/schemas.ts";
import { getErrorStatus, getPublicError } from "#lib/server/api-errors.ts";
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
    const parsed = RegisterUserSchema.safeParse({
      userId: data.get("user_id"),
      password: data.get("password"),
    });
    if (!parsed.success)
      return fail(400, {
        error:
          parsed.error.issues[0]?.message ??
          "入力内容が不正です。ユーザーIDを4～32文字の英数字で、パスワードを1文字以上で入力してください。",
      });
    if (parsed.data.password !== data.get("password_confirm")) {
      return fail(400, {
        error:
          "パスワードが一致しません。確認欄へパスワードと同じ値を入力してください。",
      });
    }

    try {
      const userInfo = await api.registerUser(
        parsed.data.userId,
        parsed.data.password,
      );
      const token = await createSessionToken(userInfo.id);
      setSessionCookie(cookies, token);
    } catch (e) {
      return fail(getErrorStatus(e), { error: getPublicError(e).message });
    }

    redirect(302, "/");
  },
};
