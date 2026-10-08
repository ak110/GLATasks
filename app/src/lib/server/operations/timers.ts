import * as api from "../api";
import { notify, type OperationContext } from "./context";
import { SSE_EVENTS } from "#lib/sse-events.ts";
import type { z } from "zod";
import type {
  ReorderTimersSchema,
  CreateTimerSchema,
  UpdateTimerSchema,
  TimerIdSchema,
  StartTimerSchema,
  ResetTimerSchema,
  AdjustTimerSchema,
  SetTimerTimeSchema,
  TimerStopSchema,
} from "#lib/schemas.ts";

export const timers = {
  async list(ctx: OperationContext) {
    return api.listTimers(ctx.userId);
  },

  async reorder(
    ctx: OperationContext,
    input: z.infer<typeof ReorderTimersSchema>,
  ) {
    await api.reorderTimers(ctx.userId, input.timerIds);

    notify(ctx, [SSE_EVENTS.timersUpdated]);
    return { success: true as const };
  },

  async create(
    ctx: OperationContext,
    input: z.infer<typeof CreateTimerSchema>,
  ) {
    await api.createTimer({
      userId: ctx.userId,
      name: input.name,
      baseSeconds: input.baseSeconds,
      adjustMinutes: input.adjustMinutes,
      mode: input.mode,
      targetMinutes: input.targetMinutes,
      tzOffsetMinutes: input.tzOffsetMinutes,
      ephemeral: input.ephemeral,
      ringSeconds: input.ringSeconds,
    });

    notify(ctx, [SSE_EVENTS.timersUpdated]);
    return { success: true as const };
  },

  async update(
    ctx: OperationContext,
    input: z.infer<typeof UpdateTimerSchema>,
  ) {
    const { timerId, ...data } = input;
    await api.updateTimer(ctx.userId, timerId, data);

    notify(ctx, [SSE_EVENTS.timersUpdated]);
    return { success: true as const };
  },

  async delete(ctx: OperationContext, input: z.infer<typeof TimerIdSchema>) {
    await api.deleteTimer(ctx.userId, input.timerId);

    notify(ctx, [SSE_EVENTS.timersUpdated]);
    return { success: true as const };
  },

  async start(ctx: OperationContext, input: z.infer<typeof StartTimerSchema>) {
    await api.startTimer(ctx.userId, input.timerId, input.tzOffsetMinutes);

    notify(ctx, [SSE_EVENTS.timersUpdated]);
    return { success: true as const };
  },

  async pause(ctx: OperationContext, input: z.infer<typeof TimerIdSchema>) {
    await api.pauseTimer(ctx.userId, input.timerId);

    notify(ctx, [SSE_EVENTS.timersUpdated]);
    return { success: true as const };
  },

  async reset(ctx: OperationContext, input: z.infer<typeof ResetTimerSchema>) {
    await api.resetTimer(ctx.userId, input.timerId, input.tzOffsetMinutes);

    notify(ctx, [SSE_EVENTS.timersUpdated]);
    return { success: true as const };
  },

  async adjust(
    ctx: OperationContext,
    input: z.infer<typeof AdjustTimerSchema>,
  ) {
    await api.adjustTimer(ctx.userId, input.timerId, input.minutes);

    notify(ctx, [SSE_EVENTS.timersUpdated]);
    return { success: true as const };
  },

  async setTime(
    ctx: OperationContext,
    input: z.infer<typeof SetTimerTimeSchema>,
  ) {
    await api.setTimerTime(
      ctx.userId,
      input.timerId,
      input.seconds,
      input.targetMinutes,
      input.tzOffsetMinutes,
    );

    notify(ctx, [SSE_EVENTS.timersUpdated]);
    return { success: true as const };
  },

  async stop(ctx: OperationContext, input: z.infer<typeof TimerStopSchema>) {
    await api.stopTimer(ctx.userId, input.timerId, input.startedAt);

    notify(ctx, [SSE_EVENTS.timersUpdated]);
    return { success: true as const };
  },
};
