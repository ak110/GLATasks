import * as api from "../api";
import { notify, type OperationContext } from "./context";
import { SSE_EVENTS } from "#lib/sse-events.ts";
import type { z } from "zod";
import type {
  CreateAttachmentSchema,
  DeleteAttachmentSchema,
  DownloadAttachmentSchema,
} from "#lib/schemas.ts";

export const attachments = {
  async create(
    ctx: OperationContext,
    input: z.infer<typeof CreateAttachmentSchema>,
  ) {
    await api.createAttachment({ userId: ctx.userId, ...input });

    notify(ctx, [SSE_EVENTS.tasksUpdated]);
    return { success: true as const };
  },

  async delete(
    ctx: OperationContext,
    input: z.infer<typeof DeleteAttachmentSchema>,
  ) {
    await api.deleteAttachment({
      userId: ctx.userId,
      attachmentId: input.attachmentId,
    });

    notify(ctx, [SSE_EVENTS.tasksUpdated]);
    return { success: true as const };
  },

  async download(
    ctx: OperationContext,
    input: z.infer<typeof DownloadAttachmentSchema>,
  ) {
    return api.downloadAttachment({
      userId: ctx.userId,
      attachmentId: input.attachmentId,
    });
  },
};
