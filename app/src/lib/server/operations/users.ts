import * as api from "../api";
import { notify, type OperationContext } from "./context";
import { SSE_EVENTS } from "#lib/sse-events.ts";
import type { z } from "zod";
import type { UserPreferencesSchema } from "#lib/schemas.ts";

export const users = {
  async getPreferences(ctx: OperationContext) {
    return api.getUserPreferences(ctx.userId);
  },

  async updatePreferences(
    ctx: OperationContext,
    input: z.infer<typeof UserPreferencesSchema>,
  ) {
    await api.updateUserPreferences(ctx.userId, input);

    notify(ctx, [SSE_EVENTS.usersPreferencesUpdated]);
    return { success: true as const };
  },
};
