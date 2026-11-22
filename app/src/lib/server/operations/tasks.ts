import * as api from "../api";
import { notify, type OperationContext } from "./context";
import { SSE_EVENTS } from "#lib/sse-events.ts";
import type { z } from "zod";
import type {
  GetListTasksSchema,
  GetActiveTasksSchema,
  CreateTaskSchema,
  UpdateTaskSchema,
  ListTaskPageSchema,
  FindArchivePageSchema,
  SearchTaskPageSchema,
  ReorderArchivePageSchema,
  SearchTasksSchema,
  ReorderTasksSchema,
} from "#lib/schemas.ts";

export const tasks = {
  async archiveTagCandidates(
    ctx: OperationContext,
    input: Pick<z.infer<typeof GetListTasksSchema>, "listId">,
  ) {
    return api.archiveTagCandidates(ctx.userId, input.listId);
  },

  async listPage(
    ctx: OperationContext,
    input: z.infer<typeof ListTaskPageSchema>,
  ) {
    return api.listTaskPage(ctx.userId, input.listId, input.page);
  },

  async findArchivePage(
    ctx: OperationContext,
    input: z.infer<typeof FindArchivePageSchema>,
  ) {
    return api.findArchivePage(ctx.userId, input.listId, input.taskId);
  },

  async searchPage(
    ctx: OperationContext,
    input: z.infer<typeof SearchTaskPageSchema>,
  ) {
    return api.searchTaskPage(
      ctx.userId,
      input.query,
      input.showType,
      input.selectedListId,
      input.page,
    );
  },

  async reorderArchivePage(
    ctx: OperationContext,
    input: z.infer<typeof ReorderArchivePageSchema>,
  ) {
    await api.reorderArchivePage(ctx.userId, input);
    notify(ctx, [SSE_EVENTS.tasksUpdated]);
  },

  async list(ctx: OperationContext, input: z.infer<typeof GetListTasksSchema>) {
    return api.listTasks(
      ctx.userId,
      input.listId,
      input.showType,
      input.ifModifiedSince,
    );
  },

  async listActive(
    ctx: OperationContext,
    input: z.infer<typeof GetActiveTasksSchema>,
  ) {
    const since = input.since ? new Date(input.since) : undefined;
    return api.listActiveTasks(ctx.userId, since);
  },

  async create(ctx: OperationContext, input: z.infer<typeof CreateTaskSchema>) {
    const taskId = await api.createTask(
      ctx.userId,
      input.listId,
      input.text,
      input.tags,
      input.kind,
    );
    notify(ctx, [SSE_EVENTS.tasksUpdated]);
    return { success: true as const, taskId };
  },

  async update(ctx: OperationContext, input: z.infer<typeof UpdateTaskSchema>) {
    const { listId, taskId, ...data } = input;
    await api.updateTask(ctx.userId, listId, taskId, data);

    notify(ctx, [SSE_EVENTS.tasksUpdated]);
    return { success: true as const };
  },

  async search(
    ctx: OperationContext,
    input: z.infer<typeof SearchTasksSchema>,
  ) {
    return api.searchTasks(ctx.userId, input.query, input.showType);
  },

  async reorder(
    ctx: OperationContext,
    input: z.infer<typeof ReorderTasksSchema>,
  ) {
    await api.reorderTasks(ctx.userId, input.listId, input.taskIds);

    notify(ctx, [SSE_EVENTS.tasksUpdated]);
    return { success: true as const };
  },
};
