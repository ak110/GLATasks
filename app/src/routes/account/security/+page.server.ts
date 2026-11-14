import type { PageServerLoad } from "./$types";
import { listSecurity } from "#lib/server/api/security.ts";
export const load: PageServerLoad = async ({ locals, cookies }) =>
  listSecurity(locals.user_id!, cookies);
