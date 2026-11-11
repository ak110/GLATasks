import type { Cookies } from "@sveltejs/kit";
import type { z } from "zod";
import type { ManageSecuritySchema } from "#lib/passkey-schemas.ts";
import * as api from "../api/security";
import { beginAuthentication } from "../api/passkey-webauthn";
import { setAttempt } from "../passkey-cookies";
import { ApiError } from "../api-errors";

interface SecurityContext {
  userId: number;
  cookies?: Cookies;
}
function cookies(ctx: SecurityContext) {
  if (!ctx.cookies) throw new ApiError("auth_failed");
  return ctx.cookies;
}
export const security = {
  list: (ctx: SecurityContext) => api.listSecurity(ctx.userId),
  async beginVerification(ctx: SecurityContext) {
    const result = await beginAuthentication(ctx.userId);
    setAttempt(cookies(ctx), "reauth", result.id);
    return result.options;
  },
  manage: (ctx: SecurityContext, input: z.infer<typeof ManageSecuritySchema>) =>
    api.manageSecurity(ctx.userId, cookies(ctx), input),
};
