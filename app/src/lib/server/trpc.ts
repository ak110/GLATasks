/**
 * @fileoverview tRPC ルーター定義と暗号化ミドルウェア
 */

import { initTRPC, TRPCError } from "@trpc/server";
import type { RequestEvent } from "@sveltejs/kit";
import {
  CreateAttachmentSchema,
  CreateListSchema,
  CreateTaskSchema,
  CreateTimerSchema,
  DeleteAttachmentSchema,
  DownloadAttachmentInputSchema,
  GetActiveTasksSchema,
  GetListTasksSchema,
  MergeListSchema,
  RegisterUserSchema,
  ShowTypeSchema,
  UpdateListSchema,
  UpdateTaskSchema,
  UpdateTimerSchema,
  TimerIdSchema,
  TimerStopSchema,
  AdjustTimerSchema,
  SetTimerTimeSchema,
  StartTimerSchema,
  ResetTimerSchema,
  LoginSchema,
  SearchTasksSchema,
  ReorderTasksSchema,
  ReorderTimersSchema,
  UserPreferencesSchema,
} from "$lib/schemas";
import * as api from "./api";
import { decryptToString, encryptObject } from "./crypto";
import { sendEvent } from "./sse";
import { SSE_EVENTS } from "$lib/sse-events";
import type { SseEventName } from "$lib/sse-events";

// ── Context 型定義 ──

interface Context {
  event: RequestEvent;
  userId: number | null;
  encryptKey: string;
  tabId: string | null;
}

// ── tRPC 初期化 ──

const t = initTRPC.context<Context>().create();

// ── ミドルウェア ──

/**
 * 認証必須ミドルウェア
 */
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "ログインが必要です",
    });
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
    },
  });
});

/**
 * 暗号化ミドルウェア: 入力を復号化し、出力を暗号化する
 */
const withEncryption = t.middleware(async ({ getRawInput, next }) => {
  // getRawInput() で生の入力を取得（tRPC v11 API）
  const rawInput = await getRawInput();

  // 入力が暗号化されている場合は復号化
  let decryptedInput = rawInput;
  if (
    typeof rawInput === "object" &&
    rawInput !== null &&
    "encrypted" in rawInput &&
    typeof (rawInput as Record<string, unknown>).encrypted === "string"
  ) {
    try {
      const decryptedStr = await decryptToString(
        (rawInput as Record<string, unknown>).encrypted as string,
      );
      decryptedInput = JSON.parse(decryptedStr);
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Failed to decrypt input",
        cause: error,
      });
    }
  }

  // 次のミドルウェア/プロシージャを実行（復号化した入力を渡す）
  const result = await next({
    getRawInput: async () => decryptedInput,
  });

  // 出力を暗号化して返す（result を直接変更し型推論を保持する）
  if (result.ok) {
    assignEncryptedData(result, {
      encrypted: await encryptObject(result.data),
    });
  }

  return result;
});

// ── エラーメッセージマッピング ──

/** api.ts の機械可読な識別子 → tRPC エラーコード・表示用メッセージ */
const API_ERRORS: Record<
  string,
  { code: "NOT_FOUND" | "BAD_REQUEST"; message: string }
> = {
  not_found_or_forbidden: {
    code: "NOT_FOUND",
    message: "対象が見つかりません",
  },
  task_not_found: { code: "NOT_FOUND", message: "タスクが見つかりません" },
  attachment_not_found: {
    code: "NOT_FOUND",
    message: "添付ファイルが見つかりません",
  },
  attachment_too_large: {
    code: "BAD_REQUEST",
    message: "ファイルサイズが上限を超えています",
  },
  attachment_limit_exceeded: {
    code: "BAD_REQUEST",
    message: "添付ファイルの件数上限に達しています",
  },
  same_list: { code: "BAD_REQUEST", message: "同じリストは統合できません" },
  list_not_active: {
    code: "BAD_REQUEST",
    message: "アーカイブ済みリストは統合できません",
  },
  invalid_timer_ids: { code: "BAD_REQUEST", message: "タイマーIDが不正です" },
  timer_is_running: {
    code: "BAD_REQUEST",
    message: "タイマー実行中は変更できません",
  },
  alarm_missing_params: {
    code: "BAD_REQUEST",
    message: "アラームモードでは目標時刻とタイムゾーンオフセットが必須です",
  },
  countdown_missing_base_seconds: {
    code: "BAD_REQUEST",
    message: "カウントダウンモードではベース時間が必須です",
  },
};

/**
 * API エラー変換ミドルウェア:
 * api.ts の機械可読な識別子を適切な TRPCError に変換する
 *
 * tRPC v11 の `next()` は例外を再送出せず `{ok: false, error}` で返すため、
 * `!result.ok` 分岐のみで判定する。
 */
const withApiErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const err = result.error;
    if (err instanceof TRPCError && err.cause instanceof Error) {
      const msg = err.cause.message;
      if (msg in API_ERRORS) {
        const mapped = API_ERRORS[msg];
        throw new TRPCError({
          code: mapped.code,
          message: mapped.message,
          cause: err.cause,
        });
      }
    }
    if (err instanceof Error && err.message in API_ERRORS) {
      const mapped = API_ERRORS[err.message];
      throw new TRPCError({ code: mapped.code, message: mapped.message });
    }
  }
  return result;
});

// ── ヘルパー関数 ──

/**
 * `withEncryption` ミドルウェアがハンドラーの平文 `data` フィールドを暗号化済みの値で上書きするためのヘルパー。
 *
 * なぜこの上書きが必要か:
 *   `withEncryption` ミドルウェアは、ハンドラーが返した平文の `data` フィールドを
 *   暗号化後の値（`{ encrypted: string }` 形式）で置き換えてクライアントへ返す必要がある。
 *
 * なぜキャストが必要か:
 *   tRPC の内部結果型（`TRPCResultMessage` 等）は `unknown` 扱いであり、
 *   Drizzle/Zod から推論されるハンドラーの戻り値型と直接合わない。
 *   型推論を壊さずに `data` フィールドだけを差し替えるため、二重キャストでアクセスする。
 *
 * 制約:
 *   呼び出し側（`withEncryption` ミドルウェア）は、`result` が `{ data: <平文の値> }` 形式であることを
 *   ミドルウェアの位置（`result.ok` チェック後）で保証している。
 */
function assignEncryptedData(
  result: unknown,
  data: { encrypted: string },
): void {
  (result as unknown as Record<string, unknown>).data = data;
}

/**
 * SSEイベントを自動送信して `{ success: true }` を返す mutation ハンドラーファクトリー。
 *
 * `.mutation(eventMutationHandler(...))` の形で使い、
 * ハンドラーは副作用のみを担い、SSE通知と戻り値の組み立ては本関数が担う。
 * これによりSSE通知漏れを構造的に防ぐ。
 *
 * @param eventName - 送信するSSEイベント種別
 * @param handler - 副作用を実行する非同期関数（戻り値は不要）
 * @returns procedure builder の `.mutation()` に渡すコールバック
 */
function eventMutationHandler<
  TCtx extends { userId: number; tabId: string | null },
  TInput,
>(
  eventName: SseEventName,
  handler: (params: { ctx: TCtx; input: TInput }) => Promise<void> | void,
) {
  return async ({ ctx, input }: { ctx: TCtx; input: TInput }) => {
    await handler({ ctx, input });
    sendEvent(ctx.userId, eventName, ctx.tabId);
    return { success: true as const };
  };
}

// ── プロシージャ定義 ──

const publicProcedure = t.procedure;
const protectedProcedure = t.procedure.use(isAuthed).use(withApiErrors);
const encryptedProcedure = protectedProcedure.use(withEncryption);

// ── ルーター定義 ──

export const appRouter = t.router({
  // ── 利用者設定 ──
  users: t.router({
    getPreferences: encryptedProcedure.query(async ({ ctx }) => {
      return api.getUserPreferences(ctx.userId);
    }),

    updatePreferences: encryptedProcedure.input(UserPreferencesSchema).mutation(
      eventMutationHandler(
        SSE_EVENTS.usersPreferencesUpdated,
        async ({ ctx, input }) => {
          await api.updateUserPreferences(ctx.userId, input);
        },
      ),
    ),
  }),

  // ── 認証 ──
  auth: t.router({
    login: publicProcedure.input(LoginSchema).mutation(async ({ input }) => {
      const user = await api.validateCredentials(input.userId, input.password);
      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "ユーザーIDまたはパスワードが間違っています",
        });
      }
      return user;
    }),

    register: publicProcedure
      .input(RegisterUserSchema)
      .mutation(async ({ input }) => {
        return api.registerUser(input.userId, input.password);
      }),
  }),

  // ── リスト操作 ──
  lists: t.router({
    list: encryptedProcedure
      .input(ShowTypeSchema)
      .query(async ({ ctx, input }) => {
        return api.getLists(ctx.userId, input);
      }),

    create: encryptedProcedure.input(CreateListSchema).mutation(
      eventMutationHandler(SSE_EVENTS.listsUpdated, async ({ ctx, input }) => {
        await api.postList(ctx.userId, input.title);
      }),
    ),

    rename: encryptedProcedure.input(UpdateListSchema).mutation(
      eventMutationHandler(SSE_EVENTS.listsUpdated, async ({ ctx, input }) => {
        await api.renameList(ctx.userId, input.listId, input.title);
      }),
    ),

    delete: encryptedProcedure
      .input(UpdateListSchema.pick({ listId: true }))
      .mutation(
        eventMutationHandler(
          SSE_EVENTS.listsUpdated,
          async ({ ctx, input }) => {
            await api.deleteList(ctx.userId, input.listId);
          },
        ),
      ),

    archive: encryptedProcedure
      .input(UpdateListSchema.pick({ listId: true }))
      .mutation(
        eventMutationHandler(
          SSE_EVENTS.listsUpdated,
          async ({ ctx, input }) => {
            await api.archiveList(ctx.userId, input.listId);
          },
        ),
      ),

    unarchive: encryptedProcedure
      .input(UpdateListSchema.pick({ listId: true }))
      .mutation(
        eventMutationHandler(
          SSE_EVENTS.listsUpdated,
          async ({ ctx, input }) => {
            await api.unarchiveList(ctx.userId, input.listId);
          },
        ),
      ),

    clear: encryptedProcedure
      .input(UpdateListSchema.pick({ listId: true }))
      .mutation(
        eventMutationHandler(
          SSE_EVENTS.tasksUpdated,
          async ({ ctx, input }) => {
            await api.clearList(ctx.userId, input.listId);
          },
        ),
      ),

    // 2つのリソース（listsUpdated + tasksUpdated）に影響するため
    // eventMutationHandler（単一イベントのみ対応）は使わず、sendEvent を直接呼ぶ
    merge: encryptedProcedure
      .input(MergeListSchema)
      .mutation(async ({ ctx, input }) => {
        await api.mergeLists(
          ctx.userId,
          input.sourceListId,
          input.targetListId,
        );
        sendEvent(ctx.userId, SSE_EVENTS.listsUpdated, ctx.tabId);
        sendEvent(ctx.userId, SSE_EVENTS.tasksUpdated, ctx.tabId);
        return { success: true as const };
      }),
  }),

  // ── タスク操作 ──
  tasks: t.router({
    list: encryptedProcedure
      .input(GetListTasksSchema)
      .query(async ({ ctx, input }) => {
        return api.getListTasks(
          ctx.userId,
          input.listId,
          input.showType,
          input.ifModifiedSince,
        );
      }),

    listActive: encryptedProcedure
      .input(GetActiveTasksSchema)
      .query(async ({ ctx, input }) => {
        const since = input.since ? new Date(input.since) : undefined;
        return api.getActiveTasks(ctx.userId, since);
      }),

    // 戻り値に taskId を含めるため eventMutationHandler は使わず直接 sendEvent を呼ぶ
    create: encryptedProcedure
      .input(CreateTaskSchema)
      .mutation(async ({ ctx, input }) => {
        const taskId = await api.postTask(
          ctx.userId,
          input.listId,
          input.text,
          input.tags,
        );
        sendEvent(ctx.userId, SSE_EVENTS.tasksUpdated, ctx.tabId);
        return { success: true as const, taskId };
      }),

    update: encryptedProcedure.input(UpdateTaskSchema).mutation(
      eventMutationHandler(SSE_EVENTS.tasksUpdated, async ({ ctx, input }) => {
        const { listId, taskId, ...data } = input;
        await api.patchTask(ctx.userId, listId, taskId, data);
      }),
    ),

    search: encryptedProcedure
      .input(SearchTasksSchema)
      .query(async ({ ctx, input }) => {
        return api.searchTasks(ctx.userId, input.query);
      }),

    reorder: encryptedProcedure.input(ReorderTasksSchema).mutation(
      eventMutationHandler(SSE_EVENTS.tasksUpdated, async ({ ctx, input }) => {
        await api.reorderTasks(ctx.userId, input.listId, input.taskIds);
      }),
    ),
  }),

  // ── 添付ファイル操作 ──
  attachments: t.router({
    create: encryptedProcedure.input(CreateAttachmentSchema).mutation(
      eventMutationHandler(SSE_EVENTS.tasksUpdated, async ({ ctx, input }) => {
        await api.createAttachment({ userId: ctx.userId, ...input });
      }),
    ),

    delete: encryptedProcedure.input(DeleteAttachmentSchema).mutation(
      eventMutationHandler(SSE_EVENTS.tasksUpdated, async ({ ctx, input }) => {
        await api.deleteAttachment({
          userId: ctx.userId,
          attachmentId: input.attachmentId,
        });
      }),
    ),

    download: encryptedProcedure
      .input(DownloadAttachmentInputSchema)
      .query(async ({ ctx, input }) => {
        return api.downloadAttachment({
          userId: ctx.userId,
          attachmentId: input.attachmentId,
        });
      }),
  }),

  // ── タイマー操作 ──
  timers: t.router({
    list: encryptedProcedure.query(async ({ ctx }) => {
      return api.getTimers(ctx.userId);
    }),

    reorder: encryptedProcedure.input(ReorderTimersSchema).mutation(
      eventMutationHandler(SSE_EVENTS.timersUpdated, async ({ ctx, input }) => {
        await api.reorderTimers(ctx.userId, input.timerIds);
      }),
    ),

    create: encryptedProcedure.input(CreateTimerSchema).mutation(
      eventMutationHandler(SSE_EVENTS.timersUpdated, async ({ ctx, input }) => {
        await api.createTimer(
          ctx.userId,
          input.name,
          input.base_seconds,
          input.adjust_minutes,
          input.mode,
          input.target_minutes ?? null,
          input.tz_offset_minutes ?? null,
          input.ephemeral,
          input.keep_ringing,
        );
      }),
    ),

    update: encryptedProcedure.input(UpdateTimerSchema).mutation(
      eventMutationHandler(SSE_EVENTS.timersUpdated, async ({ ctx, input }) => {
        const { timerId, ...data } = input;
        await api.updateTimer(ctx.userId, timerId, data);
      }),
    ),

    delete: encryptedProcedure.input(TimerIdSchema).mutation(
      eventMutationHandler(SSE_EVENTS.timersUpdated, async ({ ctx, input }) => {
        await api.deleteTimer(ctx.userId, input.timerId);
      }),
    ),

    start: encryptedProcedure.input(StartTimerSchema).mutation(
      eventMutationHandler(SSE_EVENTS.timersUpdated, async ({ ctx, input }) => {
        await api.startTimer(
          ctx.userId,
          input.timerId,
          input.tz_offset_minutes,
        );
      }),
    ),

    pause: encryptedProcedure.input(TimerIdSchema).mutation(
      eventMutationHandler(SSE_EVENTS.timersUpdated, async ({ ctx, input }) => {
        await api.pauseTimer(ctx.userId, input.timerId);
      }),
    ),

    reset: encryptedProcedure.input(ResetTimerSchema).mutation(
      eventMutationHandler(SSE_EVENTS.timersUpdated, async ({ ctx, input }) => {
        await api.resetTimer(
          ctx.userId,
          input.timerId,
          input.tz_offset_minutes,
        );
      }),
    ),

    adjust: encryptedProcedure.input(AdjustTimerSchema).mutation(
      eventMutationHandler(SSE_EVENTS.timersUpdated, async ({ ctx, input }) => {
        await api.adjustTimer(ctx.userId, input.timerId, input.minutes);
      }),
    ),

    setTime: encryptedProcedure.input(SetTimerTimeSchema).mutation(
      eventMutationHandler(SSE_EVENTS.timersUpdated, async ({ ctx, input }) => {
        await api.setTimerTime(
          ctx.userId,
          input.timerId,
          input.seconds,
          input.target_minutes,
          input.tz_offset_minutes,
        );
      }),
    ),

    stop: encryptedProcedure.input(TimerStopSchema).mutation(
      eventMutationHandler(SSE_EVENTS.timersUpdated, async ({ ctx, input }) => {
        await api.stopTimer(ctx.userId, input.timerId, input.started_at);
      }),
    ),
  }),
});

export type AppRouter = typeof appRouter;
