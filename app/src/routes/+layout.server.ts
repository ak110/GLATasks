import { redirect } from "@sveltejs/kit";
import { getEncryptKey } from "$lib/server/env";
import type { LayoutServerLoad } from "./$types";

const PUBLIC_PATHS = ["/auth/login", "/auth/regist_user", "/oauth/authorize"];

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (PUBLIC_PATHS.includes(url.pathname)) {
    return {};
  }

  if (!locals.user_id) {
    redirect(302, "/auth/login");
  }

  return {
    encrypt_key: getEncryptKey(),
    logged_in: true,
  };
};
