import * as api from "../api";
import { notify, type OperationContext } from "./context";
import { SSE_EVENTS } from "#lib/sse-events.ts";
import type { z } from "zod";
import type {
  ListSchedulesSchema,
  CreateScheduleSchema,
  UpdateScheduleSchema,
  DeleteScheduleSchema,
} from "../schedule-schemas";

export const schedules = {
  async list(
    ctx: OperationContext,
    input: z.infer<typeof ListSchedulesSchema>,
  ) {
    return api.listSchedules(ctx.userId, input.listId);
  },

  async create(
    ctx: OperationContext,
    input: z.infer<typeof CreateScheduleSchema>,
  ) {
    const schedule = await api.createSchedule(ctx.userId, input);
    notify(ctx, [SSE_EVENTS.schedulesUpdated]);
    return { success: true as const, schedule };
  },

  async update(
    ctx: OperationContext,
    input: z.infer<typeof UpdateScheduleSchema>,
  ) {
    const { scheduleId, ...data } = input;
    const schedule = await api.updateSchedule(ctx.userId, scheduleId, data);
    notify(ctx, [SSE_EVENTS.schedulesUpdated]);
    return { success: true as const, schedule };
  },

  async delete(
    ctx: OperationContext,
    input: z.infer<typeof DeleteScheduleSchema>,
  ) {
    await api.deleteSchedule(ctx.userId, input.scheduleId);

    notify(ctx, [SSE_EVENTS.schedulesUpdated]);
    return { success: true as const };
  },
};
