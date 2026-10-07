import * as api from "../api";
import { notify, type OperationContext } from "./context";
import { SSE_EVENTS } from "#lib/sse-events.ts";
import type { z } from "zod";
import type {
  CreateCalorieItemSchema,
  UpdateCalorieItemSchema,
  CalorieItemIdSchema,
  ListCalorieRecordsSchema,
  CreateCalorieRecordSchema,
  UpdateCalorieRecordSchema,
  CalorieRecordIdSchema,
  GetCalorieSummarySchema,
  ImportCalorieItemsSchema,
  ImportCalorieRecordsSchema,
  BulkCreateCalorieRecordsSchema,
  BulkDeleteCalorieRecordsSchema,
  CreateCalorieAutoRecordSchema,
  UpdateCalorieAutoRecordSchema,
  CalorieAutoRecordIdSchema,
} from "#lib/schemas.ts";

export const calories = {
  async items(ctx: OperationContext) {
    return api.getCalorieItems(ctx.userId);
  },

  async createItem(
    ctx: OperationContext,
    input: z.infer<typeof CreateCalorieItemSchema>,
  ) {
    await api.createCalorieItem(ctx.userId, input);

    notify(ctx, [SSE_EVENTS.caloriesUpdated]);
    return { success: true as const };
  },

  async updateItem(
    ctx: OperationContext,
    input: z.infer<typeof UpdateCalorieItemSchema>,
  ) {
    await api.updateCalorieItem(ctx.userId, input);

    notify(ctx, [SSE_EVENTS.caloriesUpdated]);
    return { success: true as const };
  },

  async deleteItem(
    ctx: OperationContext,
    input: z.infer<typeof CalorieItemIdSchema>,
  ) {
    await api.deleteCalorieItem(ctx.userId, input.itemId);

    notify(ctx, [SSE_EVENTS.caloriesUpdated]);
    return { success: true as const };
  },

  async records(
    ctx: OperationContext,
    input: z.infer<typeof ListCalorieRecordsSchema>,
  ) {
    return api.getCalorieRecords(ctx.userId, input);
  },

  async allRecords(ctx: OperationContext) {
    return api.getAllCalorieRecords(ctx.userId);
  },

  async createRecord(
    ctx: OperationContext,
    input: z.infer<typeof CreateCalorieRecordSchema>,
  ) {
    await api.createCalorieRecord(ctx.userId, input);

    notify(ctx, [SSE_EVENTS.caloriesUpdated]);
    return { success: true as const };
  },

  async updateRecord(
    ctx: OperationContext,
    input: z.infer<typeof UpdateCalorieRecordSchema>,
  ) {
    await api.updateCalorieRecord(ctx.userId, input);

    notify(ctx, [SSE_EVENTS.caloriesUpdated]);
    return { success: true as const };
  },

  async deleteRecord(
    ctx: OperationContext,
    input: z.infer<typeof CalorieRecordIdSchema>,
  ) {
    await api.deleteCalorieRecord(ctx.userId, input.recordId);

    notify(ctx, [SSE_EVENTS.caloriesUpdated]);
    return { success: true as const };
  },

  async summary(
    ctx: OperationContext,
    input: z.infer<typeof GetCalorieSummarySchema>,
  ) {
    return api.getCalorieSummary(ctx.userId, input.tzOffsetMinutes);
  },

  async importItems(
    ctx: OperationContext,
    input: z.infer<typeof ImportCalorieItemsSchema>,
  ) {
    const result = await api.importCalorieItems(ctx.userId, input.rows);
    notify(ctx, [SSE_EVENTS.caloriesUpdated]);
    return result;
  },

  async importRecords(
    ctx: OperationContext,
    input: z.infer<typeof ImportCalorieRecordsSchema>,
  ) {
    const result = await api.importCalorieRecords(
      ctx.userId,
      input.rows,
      input.tzOffsetMinutes,
    );
    notify(ctx, [SSE_EVENTS.caloriesUpdated]);
    return result;
  },

  async bulkCreateRecords(
    ctx: OperationContext,
    input: z.infer<typeof BulkCreateCalorieRecordsSchema>,
  ) {
    const result = await api.bulkCreateCalorieRecords(ctx.userId, input);
    notify(ctx, [SSE_EVENTS.caloriesUpdated]);
    return result;
  },

  async bulkDeleteRecords(
    ctx: OperationContext,
    input: z.infer<typeof BulkDeleteCalorieRecordsSchema>,
  ) {
    const result = await api.bulkDeleteCalorieRecords(ctx.userId, input);
    notify(ctx, [SSE_EVENTS.caloriesUpdated]);
    return result;
  },

  async autoRecords(ctx: OperationContext) {
    return api.getCalorieAutoRecords(ctx.userId);
  },

  async createAutoRecord(
    ctx: OperationContext,
    input: z.infer<typeof CreateCalorieAutoRecordSchema>,
  ) {
    await api.createCalorieAutoRecord(ctx.userId, input);

    notify(ctx, [SSE_EVENTS.caloriesUpdated]);
    return { success: true as const };
  },

  async updateAutoRecord(
    ctx: OperationContext,
    input: z.infer<typeof UpdateCalorieAutoRecordSchema>,
  ) {
    await api.updateCalorieAutoRecord(ctx.userId, input);

    notify(ctx, [SSE_EVENTS.caloriesUpdated]);
    return { success: true as const };
  },

  async deleteAutoRecord(
    ctx: OperationContext,
    input: z.infer<typeof CalorieAutoRecordIdSchema>,
  ) {
    await api.deleteCalorieAutoRecord(ctx.userId, input.autoRecordId);

    notify(ctx, [SSE_EVENTS.caloriesUpdated]);
    return { success: true as const };
  },
};
