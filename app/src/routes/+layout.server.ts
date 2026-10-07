import { getEncryptKey } from "#lib/server/env.ts";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user_id) return {};

  return {
    encrypt_key: getEncryptKey(),
    logged_in: true,
  };
};
