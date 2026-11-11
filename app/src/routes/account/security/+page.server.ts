import type { PageServerLoad } from "./$types";
import { listSecurity } from "#lib/server/api/security.ts";
export const load: PageServerLoad = async ({ locals }) =>
  listSecurity(locals.user_id!);
