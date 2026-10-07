import * as api from "../api";
import { notify, type OperationContext } from "./context";
import { SSE_EVENTS } from "#lib/sse-events.ts";
import type { z } from "zod";
import type {
  ShowTypeSchema,
  CreateListSchema,
  UpdateListSchema,
  MergeListSchema,
} from "#lib/schemas.ts";

export const lists = {
  async list(ctx: OperationContext, input: z.infer<typeof ShowTypeSchema>) {
    return api.listLists(ctx.userId, input);
  },

  async create(ctx: OperationContext, input: z.infer<typeof CreateListSchema>) {
    const listId = await api.createList(ctx.userId, input.title);

    notify(ctx, [SSE_EVENTS.listsUpdated]);
    return { success: true as const, listId };
  },

  async rename(ctx: OperationContext, input: z.infer<typeof UpdateListSchema>) {
    await api.renameList(ctx.userId, input.listId, input.title);

    notify(ctx, [SSE_EVENTS.listsUpdated]);
    return { success: true as const };
  },

  async delete(
    ctx: OperationContext,
    input: Pick<z.infer<typeof UpdateListSchema>, "listId">,
  ) {
    await api.deleteList(ctx.userId, input.listId);

    notify(ctx, [SSE_EVENTS.listsUpdated]);
    return { success: true as const };
  },

  async archive(
    ctx: OperationContext,
    input: Pick<z.infer<typeof UpdateListSchema>, "listId">,
  ) {
    await api.archiveList(ctx.userId, input.listId);

    notify(ctx, [SSE_EVENTS.listsUpdated]);
    return { success: true as const };
  },

  async unarchive(
    ctx: OperationContext,
    input: Pick<z.infer<typeof UpdateListSchema>, "listId">,
  ) {
    await api.unarchiveList(ctx.userId, input.listId);

    notify(ctx, [SSE_EVENTS.listsUpdated]);
    return { success: true as const };
  },

  async clear(
    ctx: OperationContext,
    input: Pick<z.infer<typeof UpdateListSchema>, "listId">,
  ) {
    await api.clearList(ctx.userId, input.listId);

    notify(ctx, [SSE_EVENTS.tasksUpdated]);
    return { success: true as const };
  },

  async merge(ctx: OperationContext, input: z.infer<typeof MergeListSchema>) {
    await api.mergeLists(ctx.userId, input.sourceListId, input.targetListId);
    notify(ctx, [SSE_EVENTS.listsUpdated]);
    notify(ctx, [SSE_EVENTS.tasksUpdated]);
    notify(ctx, [SSE_EVENTS.schedulesUpdated]);
    return { success: true as const };
  },
};
